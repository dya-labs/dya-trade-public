import type { Kline, Resolution } from "../candles/kline";
import type { HttpOptions } from "./http";
import type { LiveSink, Venue, VenueOptions, VenueRest } from "./types";
import { DAY, RESOLUTION_MS, kline, priceDecimal, volumeDecimal } from "../candles/kline";
import { prop } from "../json";
import { VenueHttp } from "./http";
import { openSocket } from "./socket";

// OKX's unqualified daily bars use UTC+8; only UTC-suffixed day/week/month bars match ours.
const bars: Record<string, string> = { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "2h": "2H", "4h": "4H", "6h": "6Hutc", "12h": "12Hutc", "1d": "1Dutc", "1w": "1Wutc", "1M": "1Mutc" };
function text(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid OKX string");
  return value;
}
function integer(value: unknown): number {
  const source = text(value);
  const result = Number(source);
  if (!/^\d+$/.test(source) || !Number.isSafeInteger(result)) throw new Error("Invalid OKX integer");
  return result;
}
function data(value: unknown): unknown[] {
  if (prop(value, "code") !== "0") throw new Error(`OKX ${String(prop(value, "code"))}: ${String(prop(value, "msg"))}`);
  const rows = prop(value, "data");
  if (!Array.isArray(rows)) throw new Error("Invalid OKX data");
  return rows;
}
function candle(row: unknown, resolution: Resolution = "1m"): Kline | null {
  if (!Array.isArray(row) || row.length !== 9 || (row[8] !== "0" && row[8] !== "1")) throw new Error("Invalid OKX candle");
  const result = kline({ openTime: integer(row[0]), open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5], quoteVolume: row[7], trades: 0, takerBuyVolume: "0", takerBuyQuoteVolume: "0" }, resolution);
  return row[8] === "1" ? result : null;
}

export function createOkxRest(options: VenueOptions, deps: Pick<HttpOptions, "fetcher" | "now" | "sleep"> = {}): VenueRest {
  const http = new VenueHttp({ venue: "okx", url: options.restUrl, budget: options.budget, ...deps });
  const now = deps.now ?? Date.now;
  async function rows(symbol: string, interval: string, after: number, before?: number, limit = 100): Promise<Kline[]> {
    const bar = bars[interval];
    if (!bar) throw new Error(`Unsupported OKX interval: ${interval}`);
    const query = new URLSearchParams({ instId: symbol, bar, after: String(after), limit: String(limit) });
    if (before !== undefined) query.set("before", String(before));
    const parsed = data(await http.get(`/api/v5/market/history-candles?${query}`)).map(row => candle(row, interval === "1h" || interval === "1d" ? interval : "1m")).filter((row): row is Kline => row !== null);
    parsed.sort((a, b) => a.openTime - b.openTime);
    return parsed.filter((row, index) => index === 0 || row.openTime !== parsed[index - 1]!.openTime);
  }
  return {
    async instruments() {
      // Rows without identifiers (pre-listing placeholders) are skipped, not fatal.
      return data(await http.get("/api/v5/public/instruments?instType=SPOT")).flatMap(row => {
        const symbol = prop(row, "instId"), base = prop(row, "baseCcy"), quote = prop(row, "quoteCcy"), state = prop(row, "state");
        return typeof symbol === "string" && symbol && typeof base === "string" && base && typeof quote === "string" && quote && typeof state === "string"
          ? [{ symbol, base, quote, status: state === "live" ? "TRADING" : state }]
          : [];
      });
    },
    async candles(symbol, resolution, from, to) {
      const coveredTo = Math.min(to, from + 100 * RESOLUTION_MS[resolution]);
      const klines = await rows(symbol, resolution, coveredTo, from - 1);
      return { klines: klines.filter(row => row.openTime >= from && row.openTime < coveredTo), coveredTo };
    },
    async earliest(symbol, resolution) {
      // Existence before a boundary is monotonic, even when the venue omits untraded bars.
      // Search daily first, then the requested resolution within the first available day.
      const end = Math.floor(now() / DAY) * DAY;
      const latest = await rows(symbol, "1d", end, undefined, 1);
      if (!latest.length && resolution === "1d") return null;
      let low = latest.length ? 0 : end / DAY, high = latest.length ? latest[0]!.openTime / DAY : end / DAY;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((await rows(symbol, "1d", (middle + 1) * DAY, undefined, 1)).length) high = middle;
        else low = middle + 1;
      }
      const day = low * DAY;
      if (resolution === "1d") return day;
      const step = RESOLUTION_MS[resolution];
      low = 0; high = Math.min(DAY / step - 1, Math.floor((now() - day) / step) - 1);
      if (high < 0) return null;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((await rows(symbol, resolution, day + (middle + 1) * step, day - 1, 1)).length) high = middle;
        else low = middle + 1;
      }
      const first = await rows(symbol, resolution, day + (low + 1) * step, day - 1, 1);
      return first[0]?.openTime ?? null;
    },
    async nativeCandles(symbol, interval, from, to) {
      const result: Kline[] = [];
      let end = to;
      while (result.length < 1000) {
        const page = (await rows(symbol, interval, end, from - 1)).filter(row => row.openTime >= from && row.openTime < end);
        result.unshift(...page);
        if (page.length < 100 || page[0]!.openTime <= from) break;
        end = page[0]!.openTime;
      }
      return result.slice(0, 1000);
    },
  };
}

/** The trades channel is update-only; explicit snapshots are never folded into live candles. */
export function parseOkxFrame(frame: string, sink: LiveSink): void {
  if (frame === "pong") return;
  try {
    const message: unknown = JSON.parse(frame);
    const event = prop(message, "event");
    if (event === "error") throw new Error(`OKX ${String(prop(message, "code"))}: ${String(prop(message, "msg"))}`);
    if (event === "subscribe" || event === "unsubscribe" || prop(message, "action") === "snapshot") return;
    const arg = prop(message, "arg"), channel = prop(arg, "channel");
    if (channel !== "trades" && channel !== "tickers") throw new Error("Invalid OKX channel");
    const symbol = text(prop(arg, "instId")), values = prop(message, "data");
    if (!Array.isArray(values)) throw new Error("Invalid OKX stream data");
    for (const value of values) {
      if (text(prop(value, "instId")) !== symbol) throw new Error("Mismatched OKX instrument");
      const time = integer(prop(value, "ts"));
      if (channel === "trades") {
        const side = prop(value, "side"), rawCount = prop(value, "count");
        const count = rawCount === undefined ? 1 : integer(rawCount);
        if ((side !== "buy" && side !== "sell") || count < 1) throw new Error("Invalid OKX trade");
        sink.trade(symbol, { time, price: priceDecimal(prop(value, "px")), quantity: volumeDecimal(prop(value, "sz")), count, takerBuy: side === "buy" });
      } else {
        const lastPrice = priceDecimal(prop(value, "last")), openPrice = priceDecimal(prop(value, "open24h"));
        const open = Number(openPrice);
        sink.ticker({ symbol, lastPrice, openPrice, highPrice: priceDecimal(prop(value, "high24h")), lowPrice: priceDecimal(prop(value, "low24h")), volume: volumeDecimal(prop(value, "vol24h")), quoteVolume: volumeDecimal(prop(value, "volCcy24h")), eventTime: time, changePercent: open > 0 ? Math.round((Number(lastPrice) - open) / open * 1e6) / 1e4 : 0 });
      }
    }
  } catch (error) { sink.invalid(String(error)); }
}

export const okx: Venue = {
  id: "okx", label: "OKX", coinGeckoId: "okex", history: ["1m"], fields: { quoteVolume: true, trades: false, takerBuy: false }, parityIntervals: Object.keys(bars),
  // History: 20 requests / 2 seconds / IP; 300/minute is half that allowance.
  defaults: { restUrl: "https://www.okx.com", streamUrl: "wss://ws.okx.com:8443/ws/v5/public", budget: 300 },
  symbol: (base, quote) => `${base}-${quote}`,
  rest: options => createOkxRest(options),
  live: options => ({
    open(symbols, sink) {
      const sockets: { close(): void }[] = [], connected = new Set<number>();
      // 50 pairs = 100 topics, comfortably below OKX's 64 KiB subscription limit.
      for (let start = 0; start < symbols.length; start += 50) {
        const id = start, group = symbols.slice(start, start + 50);
        sockets.push(openSocket({ venue: "okx", url: () => options.streamUrl,
          onOpen: send => send(JSON.stringify({ op: "subscribe", args: group.flatMap(instId => [{ channel: "trades", instId }, { channel: "tickers", instId }]) })),
          onMessage: frame => parseOkxFrame(frame, sink),
          onConnected: state => { if (state) connected.add(id); else connected.delete(id); sink.connected(connected.size === Math.ceil(symbols.length / 50)); },
          ping: { message: "ping", everyMs: 20_000 }, idleMs: 45_000,
        }));
      }
      return { close() { for (const socket of sockets) socket.close(); } };
    },
  }),
};
