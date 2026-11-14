import type { BarRange, OHLCV } from "@luxalgo/vela";
import type { DataApi, PageBar } from "./api";
import { DataApiError } from "./api";
import { pageIndex } from "./pages";
import type { MarketStream, StreamBar } from "./stream";
import { PRICE_DECIMALS } from "./price-decimals";

export const MAX_CACHED_CANDLE_PAGES = 32;

/** Data API intervals as Vela timeframes (bare minutes, then the uppercase canonical units). */
export const TIMEFRAME_BY_INTERVAL: Readonly<Record<string, string>> = {
  "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240",
  "6h": "360", "8h": "480", "12h": "720", "1d": "1D", "3d": "3D", "1w": "1W", "1M": "1M",
};

// Vela writes a timeframe in minutes ("1440" for a day, "43200" for a month) or by unit ("D", "4H", "1W").
const MINUTES_BY_UNIT: Readonly<Record<string, number>> = { "": 1, H: 60, D: 1440, W: 10_080, M: 43_200 };
const INTERVAL_BY_MINUTES: Readonly<Record<number, string>> = {
  1: "1m", 3: "3m", 5: "5m", 15: "15m", 30: "30m", 60: "1h", 120: "2h", 240: "4h", 360: "6h", 480: "8h", 720: "12h",
  1440: "1d", 4320: "3d", 10_080: "1w", 43_200: "1M",
};

/** The data API interval of a Vela timeframe in any of its spellings (`D`, `1D`, `1440`, `W`, `4H`, `60`), or undefined. */
export function intervalFor(timeframe: string) {
  const match = /^(\d*)([HDWM]?)$/.exec(timeframe.trim().toUpperCase());
  if (!match || (!match[1] && !match[2])) return undefined;
  return INTERVAL_BY_MINUTES[Number(match[1] || "1") * MINUTES_BY_UNIT[match[2]!]!];
}

export type ChartMarket = { id: string; base: string; quote: string; firstOpenTime: number };

/** Chart labels. The UI never names the exchange behind the reference series. */
export const REFERENCE_LABEL = "Reference";
export const INTENTS_LABEL = "NEAR Intents";

/** The ticker of a chart symbol, without the venue prefix Vela may add (`Reference:NEAR/USD` → `NEAR/USD`). */
export const tickerOf = (symbol: string) => symbol.slice(symbol.lastIndexOf(":") + 1);

/**
 * Chart price scale (10^decimals). Exchange markets use their venue's price step. Rhea prices are
 * derived from pool swaps with no step, so they show five significant digits; any other market
 * without a recorded step shows four significant digits and at least four decimals.
 */
export function priceScaleFor(market: { id: string; venue: string }, price: number | undefined) {
  const decimals = PRICE_DECIMALS[market.id];
  if (decimals !== undefined) return 10 ** decimals;
  if (price === undefined || !Number.isFinite(price) || price <= 0) return 10_000;
  const magnitude = Math.floor(Math.log10(price));
  return 10 ** Math.min(12, market.venue === "rhea" ? Math.max(0, 4 - magnitude) : Math.max(4, 3 - magnitude));
}

const fromPage = (row: PageBar): OHLCV => ({ time: row[0], open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) });
const fromStream = (bar: StreamBar): OHLCV => ({ time: bar.t, open: Number(bar.o), high: Number(bar.h), low: Number(bar.l), close: Number(bar.c), volume: Number(bar.v) });

/** Candles of data API markets at one revision; see {@link createBarSource}. */
export interface BarSource {
  /**
   * Bars of `market` opened before `range.to` (default: the open bar), walking back page by page
   * until `range.limit` bars and `range.from` are covered, or the market's first trade.
   */
  history(market: ChartMarket, interval: string, range: Pick<BarRange, "from" | "to" | "limit">): Promise<OHLCV[]>;
  /**
   * Live bars of `market`, never older than the last one delivered. After a reconnect the latest
   * page refills missed bars; a response started before a live update never replaces that candle.
   * Returns the unsubscribe.
   */
  live(market: ChartMarket, interval: string, onBar: (bar: OHLCV) => void): () => void;
  /** Aborts requests in flight and ends every live subscription. */
  dispose(): void;
}

/**
 * Candles of data API markets at one revision. History comes from aligned REST pages (final pages
 * are immutable, so the most recent ones are cached); live bars come from the shared stream. A
 * page or reconnect answer from another revision is never mixed in: it reports `onStale`.
 */
export function createBarSource({ api, stream, revision, onStale }: {
  api: DataApi;
  stream: Pick<MarketStream, "subscribe">;
  revision: string;
  /** The data API moved to another revision; the chart must reload with fresh metadata. */
  onStale?: () => void;
}): BarSource {
  const controller = new AbortController();
  const pages = new Map<string, Promise<{ bars: OHLCV[]; prev: number | null }>>();
  const subscriptions = new Set<() => void>();
  let disposed = false;

  function loadPage(market: ChartMarket, interval: string, page: number) {
    const key = `${market.id}:${interval}:${page}`;
    let pending = pages.get(key);
    if (!pending) {
      pending = api.page(market.id, interval, page, revision, controller.signal).then(result => ({ bars: result.bars.map(fromPage), prev: result.prev }));
      pending.catch(() => { if (pages.get(key) === pending) pages.delete(key); });
    }
    // Refresh insertion order for LRU eviction across markets and timeframes.
    pages.delete(key); pages.set(key, pending);
    while (pages.size > MAX_CACHED_CANDLE_PAGES) pages.delete(pages.keys().next().value!);
    return pending;
  }

  async function loadLatest(market: ChartMarket, interval: string) {
    const page = await api.latest(market.id, interval, controller.signal);
    if (page.revision !== revision) { onStale?.(); throw new DataApiError(502, "Market data is unavailable. Try again shortly."); }
    return page;
  }

  return {
    async history(market, interval, range) {
      if (disposed) return [];
      // Without `from`, `limit` bars cover the request; without either, the page holding `to` does.
      const to = range.to ?? Infinity, from = range.from ?? Infinity, limit = range.limit ?? 0;
      if (to <= market.firstOpenTime) return [];
      const firstPage = pageIndex(interval, market.firstOpenTime, market.firstOpenTime);
      // Final pages answer a range that ends before the current page without asking for the latest one.
      const target = Number.isFinite(to) ? pageIndex(interval, to - 1, market.firstOpenTime) : Infinity;
      const latest = target < pageIndex(interval, Date.now(), market.firstOpenTime) ? undefined : await loadLatest(market, interval);
      const chunks: OHLCV[][] = [];
      let count = 0;
      let page: number | null = latest ? Math.min(latest.page, target) : target;
      while (page !== null && page >= firstPage) {
        const loaded: { bars: OHLCV[]; prev: number | null } = page === latest?.page ? { bars: latest.bars.map(fromPage), prev: latest.prev } : await loadPage(market, interval, page);
        if (disposed) return [];
        const eligible = loaded.bars.filter(bar => bar.time < to);
        chunks.unshift(eligible);
        count += eligible.length;
        if (count >= limit && (chunks.find(chunk => chunk.length)?.[0].time ?? Infinity) <= from) break;
        if (loaded.prev !== null && loaded.prev >= page) throw new Error("Invalid candle page sequence");
        page = loaded.prev;
      }
      const bars = chunks.flat();
      const inRange = bars.filter(bar => bar.time >= from).length;
      return bars.slice(-Math.max(limit, inRange));
    },

    live(market, interval, onBar) {
      if (disposed) return () => {};
      let stopped = false, last = 0;
      let liveVersion = 0, resyncVersion = 0, appliedResync = 0;
      const unsubscribe = stream.subscribe({ type: "candle", market: market.id, interval }, {
        candle(bar) {
          if (stopped || bar.t < last) return;
          liveVersion++;
          last = bar.t;
          onBar(fromStream(bar));
        },
        resync() {
          if (stopped) return;
          const version = ++resyncVersion, liveAtRequest = liveVersion;
          void api.latest(market.id, interval, controller.signal).then(page => {
            if (stopped || version < appliedResync) return;
            appliedResync = version;
            if (page.revision !== revision) { onStale?.(); return; }
            for (const bar of page.bars.map(fromPage)) {
              if (bar.time > last || (bar.time === last && liveVersion === liveAtRequest)) { last = bar.time; onBar(bar); }
            }
          }).catch(() => {});
        },
      });
      const stop = () => { if (stopped) return; stopped = true; unsubscribe(); subscriptions.delete(stop); };
      subscriptions.add(stop);
      return stop;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      for (const stop of [...subscriptions]) stop();
      pages.clear();
    },
  };
}
