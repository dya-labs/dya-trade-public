import type { Kline } from "../candles/kline";
import type { HttpOptions } from "./http";
import type { LiveSink, Trade, Venue, VenueOptions, VenueRest } from "./types";
import { DAY, MINUTE, RESOLUTION_MS, kline, priceDecimal, volumeDecimal } from "../candles/kline";
import { prop } from "../json";
import { USER_AGENT, VenueHttp } from "./http";
import { openSocket } from "./socket";

// k-line periods in minutes. SafeTrade's 3d, 1w (Thursday) and 30d buckets count from the Unix
// epoch, not our grid, so they are not parity intervals.
const periods: Record<string, number> = { "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240, "6h": 360, "8h": 480, "12h": 720, "1d": 1440 };
const PAGE = 1000;
// The k-line endpoint rejects larger limits with `public.k_line.out_of_limit_limit`.
const MAX_LIMIT = 10_000;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function text(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid SafeTrade string");
  return value;
}
function rows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error(`SafeTrade response: ${JSON.stringify(prop(value, "errors") ?? value)}`);
  return value;
}

export function createSafeTradeRest(options: VenueOptions, deps: Pick<HttpOptions, "fetcher" | "now" | "sleep"> = {}): VenueRest {
  const http = new VenueHttp({ venue: "safetrade", url: options.restUrl, budget: options.budget, ...deps });
  const now = deps.now ?? Date.now;
  /**
   * Traded candles opening in [from, to). `time_from` floors to its period and `time_to` includes
   * the period containing it; the limit always covers the whole window, since a window wider than
   * the limit comes back truncated. Periods without trades come back as zero-volume fillers whose
   * price depends on the queried window (the same pearlusdc 3m bucket read 1.65 in one
   * response, 1.73 in another), so they are dropped.
   */
  async function page(symbol: string, interval: string, from: number, to: number): Promise<Kline[]> {
    const period = periods[interval];
    if (!period) throw new Error(`Unsupported SafeTrade interval: ${interval}`);
    const limit = Math.ceil((to - from) / (period * MINUTE));
    if (!(limit > 0 && limit <= MAX_LIMIT)) throw new Error("Invalid SafeTrade candle range");
    const query = new URLSearchParams({ period: String(period), time_from: String(Math.floor(from / 1000)), time_to: String(Math.ceil(to / 1000) - 1), limit: String(limit) });
    const result: Kline[] = [];
    for (const row of rows(await http.get(`/markets/${encodeURIComponent(symbol)}/k-line?${query}`))) {
      if (!Array.isArray(row) || row.length !== 6 || typeof row[0] !== "number" || !Number.isSafeInteger(row[0]) || row[0] < 0) throw new Error("Invalid SafeTrade candle");
      const openTime = row[0] * 1000;
      if (openTime < from || openTime >= to) continue;
      // Candles publish base volume only: no quote volume, trade count or taker split.
      const bar = kline({ openTime, open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5], quoteVolume: "0", trades: 0, takerBuyVolume: "0", takerBuyQuoteVolume: "0" }, interval === "1d" ? "1d" : "1m");
      if (bar.volume !== "0") result.push(bar);
    }
    for (let i = 1; i < result.length; i++) if (result[i]!.openTime <= result[i - 1]!.openTime) throw new Error("Unordered SafeTrade candles");
    return result;
  }
  return {
    async instruments() {
      return rows(await http.get("/markets")).map(row => ({
        symbol: text(prop(row, "id")), base: text(prop(row, "base_unit")).toUpperCase(), quote: text(prop(row, "quote_unit")).toUpperCase(),
        status: prop(row, "state") === "enabled" ? "TRADING" : text(prop(row, "state")),
      }));
    },
    async candles(symbol, resolution, from, to) {
      if (!(from < to)) throw new Error("Invalid SafeTrade candle range");
      const coveredTo = Math.min(to, from + PAGE * RESOLUTION_MS[resolution]);
      return { klines: await page(symbol, resolution, from, coveredTo), coveredTo };
    },
    async earliest(symbol, resolution) {
      // Daily candles keep the full history, including markets SafeTrade renamed (PRL → PEARL).
      const end = Math.floor(now() / MINUTE) * MINUTE;
      for (let from = 0; from < end; from += PAGE * DAY) {
        const first = (await page(symbol, "1d", from, Math.min(end, from + PAGE * DAY)))[0];
        if (!first) continue;
        if (resolution === "1d") return first.openTime;
        return (await page(symbol, resolution, first.openTime, Math.min(end, first.openTime + DAY)))[0]?.openTime ?? null;
      }
      return null;
    },
    async nativeCandles(symbol, interval, from, to) {
      const period = periods[interval];
      if (!period) throw new Error(`Unsupported SafeTrade interval: ${interval}`);
      return page(symbol, interval, from, Math.min(to, from + PAGE * period * MINUTE));
    },
  };
}

function trade(value: unknown): Trade & { id: number } {
  const id = prop(value, "id"), created = text(prop(value, "created_at"));
  if (typeof id !== "number" || !Number.isSafeInteger(id) || !TIME.test(created)) throw new Error("Invalid SafeTrade trade");
  // `side` is not documented as the taker side; the venue's candles carry no taker split either.
  return { id, time: Date.parse(created), price: priceDecimal(prop(value, "price")), quantity: volumeDecimal(prop(value, "amount")), count: 1, takerBuy: null };
}

/**
 * One public-stream frame: `<market>.trades` batches and the `global.tickers` snapshot of every
 * market (about every 5 s, without a timestamp, so `receivedAt` dates it).
 */
export function parseSafeTradeFrame(frame: unknown, symbols: ReadonlySet<string>, sink: LiveSink, receivedAt: number): void {
  if (typeof frame !== "object" || frame === null || Array.isArray(frame)) { sink.invalid("Invalid SafeTrade frame"); return; }
  for (const [stream, data] of Object.entries(frame)) {
    try {
      if (stream === "success") continue;
      if (stream === "global.tickers") {
        for (const symbol of symbols) {
          const row = prop(data, symbol);
          if (row === undefined) continue;
          const lastPrice = priceDecimal(prop(row, "last")), openPrice = priceDecimal(prop(row, "open")), open = Number(openPrice);
          sink.ticker({
            symbol, lastPrice, openPrice, highPrice: priceDecimal(prop(row, "high")), lowPrice: priceDecimal(prop(row, "low")),
            // `amount` is the base volume and `volume` the quote volume.
            volume: volumeDecimal(prop(row, "amount")), quoteVolume: volumeDecimal(prop(row, "volume")),
            changePercent: open > 0 ? Math.round((Number(lastPrice) - open) / open * 1e6) / 1e4 : 0, eventTime: receivedAt,
          });
        }
        continue;
      }
      const symbol = stream.endsWith(".trades") ? stream.slice(0, -".trades".length) : "";
      if (!symbols.has(symbol)) throw new Error(`Unexpected SafeTrade stream: ${stream}`);
      if (!Array.isArray(data)) throw new Error("Invalid SafeTrade trades");
      // Trade ids increase with execution; apply each batch oldest first.
      for (const { id: _id, ...item } of data.map(trade).sort((a, b) => a.id - b.id)) sink.trade(symbol, item);
    } catch (error) { sink.invalid(String(error)); }
  }
}

export const safetrade: Venue = {
  id: "safetrade", label: "SafeTrade", coinGeckoId: "safe_trade",
  // k-line keeps 1m candles from each market's first trade.
  history: ["1m"], fields: { quoteVolume: false, trades: false, takerBuy: false },
  parityIntervals: Object.keys(periods),
  // SafeTrade publishes no REST limit. A paced 1/s backfill drew 429 after about 360 requests in
  // 7.5 minutes; 30/min stays well below that. Cloudflare rejects Bun's default
  // User-Agent with 403 on REST and WebSocket alike.
  defaults: { restUrl: "https://safetrade.com/api/v2/trade/public", streamUrl: "wss://safetrade.com/api/v2/websocket/public", budget: 30 },
  symbol: (base, quote) => `${base}${quote}`.toLowerCase(),
  rest: options => createSafeTradeRest(options),
  live: options => ({
    open(symbols, sink) {
      const wanted = new Set(symbols);
      return openSocket({
        venue: "safetrade", url: () => options.streamUrl, headers: { "User-Agent": USER_AGENT },
        onOpen(send) { send(JSON.stringify({ event: "subscribe", streams: [...symbols.map(symbol => `${symbol}.trades`), "global.tickers"] })); },
        onMessage(raw) {
          if (raw === "pong") return;
          try { parseSafeTradeFrame(JSON.parse(raw), wanted, sink, Date.now()); } catch (error) { sink.invalid(String(error)); }
        },
        onConnected(value) { sink.connected(value); },
        // The web client pings every 20 s and gets a bare "pong".
        ping: { message: "ping", everyMs: 20_000 },
      });
    },
  }),
};
