import type { Kline } from "../candles/kline";
import type { HttpOptions } from "./http";
import type { Instrument, LiveSink, Venue, VenueOptions, VenueRest } from "./types";
import { DAY, RESOLUTION_MS, kline, priceDecimal, volumeDecimal } from "../candles/kline";
import { prop } from "../json";
import { VenueHttp } from "./http";
import { openSocket } from "./socket";

const intervals: Record<string, string> = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "6h": "360", "12h": "720", "1d": "D", "1w": "W", "1M": "M" };
function text(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid Bybit string");
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid Bybit timestamp");
  return value;
}
function result(value: unknown): unknown {
  if (prop(value, "retCode") !== 0) throw new Error(`Bybit ${String(prop(value, "retCode"))}: ${String(prop(value, "retMsg"))}`);
  return prop(value, "result");
}
function rows(value: unknown): unknown[] {
  const list = prop(value, "list");
  if (!Array.isArray(list)) throw new Error("Invalid Bybit list");
  return list;
}
function candle(value: unknown): Kline {
  if (!Array.isArray(value) || value.length < 7 || typeof value[0] !== "string" || !/^\d+$/.test(value[0])) throw new Error("Invalid Bybit candle");
  return kline({ openTime: Number(value[0]), open: value[1], high: value[2], low: value[3], close: value[4], volume: value[5], quoteVolume: value[6], trades: 0, takerBuyVolume: "0", takerBuyQuoteVolume: "0" });
}

/** V5 spot has full minute history; bounded windows avoid start=0 returning the latest page. */
export function createBybitRest(options: VenueOptions, deps: Pick<HttpOptions, "fetcher" | "now" | "sleep"> = {}): VenueRest {
  const http = new VenueHttp({ venue: "bybit", url: options.restUrl, budget: options.budget, ...deps });
  const now = deps.now ?? Date.now;
  async function query(symbol: string, interval: string, end: number, start?: number): Promise<Kline[]> {
    const params = new URLSearchParams({ category: "spot", symbol, interval, end: String(end), limit: "1000" });
    if (start !== undefined) params.set("start", String(start));
    const data = result(await http.get(`/v5/market/kline?${params}`));
    if (prop(data, "symbol") !== symbol || prop(data, "category") !== "spot") throw new Error("Invalid Bybit candle market");
    const bars = rows(data).map(candle).sort((a, b) => a.openTime - b.openTime);
    for (let i = 1; i < bars.length; i++) if (bars[i]!.openTime === bars[i - 1]!.openTime) throw new Error("Duplicate Bybit candle");
    return bars;
  }
  const rest: VenueRest = {
    async instruments() {
      const instruments: Instrument[] = [], cursors = new Set<string>();
      let cursor = "";
      do {
        const params = new URLSearchParams({ category: "spot" });
        if (cursor) params.set("cursor", cursor);
        const data = result(await http.get(`/v5/market/instruments-info?${params}`));
        for (const row of rows(data)) {
          const status = text(prop(row, "status"));
          instruments.push({ symbol: text(prop(row, "symbol")), base: text(prop(row, "baseCoin")), quote: text(prop(row, "quoteCoin")), status: status === "Trading" ? "TRADING" : status });
        }
        const next = prop(data, "nextPageCursor");
        if (next !== undefined && typeof next !== "string") throw new Error("Invalid Bybit cursor");
        cursor = typeof next === "string" ? next : "";
        if (cursor && cursors.has(cursor)) throw new Error("Repeated Bybit cursor");
        cursors.add(cursor);
      } while (cursor);
      return instruments;
    },
    async candles(symbol, resolution, from, to) {
      const coveredTo = Math.min(to, from + 1000 * RESOLUTION_MS[resolution]);
      const bars = await query(symbol, intervals[resolution]!, coveredTo - 1, from);
      return { klines: bars.filter(bar => bar.openTime >= from && bar.openTime < coveredTo), coveredTo };
    },
    async earliest(symbol, resolution) {
      let end = Math.floor(now() / DAY) * DAY - 1;
      let first: number | null = null;
      for (;;) {
        const daily = await query(symbol, "D", end);
        if (!daily.length) break;
        const oldest = daily[0]!.openTime;
        if (oldest > end) throw new Error("Bybit history did not advance");
        first = oldest;
        if (daily.length < 1000 || oldest === 0) break;
        end = oldest - 1;
      }
      // Include today's listing when there are no closed daily candles yet.
      if (first === null) {
        const today = await query(symbol, "D", now());
        first = today[0]?.openTime ?? null;
      }
      if (first === null || resolution === "1d") return first;
      for (let from = first; from < first + DAY;) {
        const page = await rest.candles(symbol, resolution, from, Math.min(first + DAY, Math.floor(now() / RESOLUTION_MS[resolution]) * RESOLUTION_MS[resolution]));
        if (page.klines.length) return page.klines[0]!.openTime;
        if (page.coveredTo <= from) break;
        from = page.coveredTo;
      }
      return null;
    },
    async nativeCandles(symbol, interval, from, to) {
      const native = intervals[interval];
      if (!native) throw new Error(`Unsupported Bybit interval: ${interval}`);
      return (await query(symbol, native, to - 1, from)).filter(bar => bar.openTime >= from && bar.openTime < to);
    },
  };
  return rest;
}

/** Bybit calls real-time trades snapshots; unlike replay snapshots these must be folded.
 * https://bybit-exchange.github.io/docs/v5/websocket/public/trade
 * Spot tickers are complete snapshots (no derivative-style delta merging).
 */
export function handleBybitFrame(value: unknown, symbols: ReadonlySet<string>, sink: LiveSink): void {
  try {
    const topic = prop(value, "topic");
    if (typeof topic !== "string") {
      if (prop(value, "success") === false) throw new Error(`Bybit subscription: ${String(prop(value, "ret_msg"))}`);
      return;
    }
    if (prop(value, "type") !== "snapshot") return;
    const separator = topic.indexOf("."), channel = topic.slice(0, separator), symbol = topic.slice(separator + 1);
    if (!symbols.has(symbol)) return;
    const data = prop(value, "data");
    if (channel === "publicTrade") {
      if (!Array.isArray(data)) throw new Error("Invalid Bybit trades");
      for (const item of data) {
        const side = prop(item, "S");
        if (prop(item, "s") !== symbol || (side !== "Buy" && side !== "Sell")) throw new Error("Invalid Bybit trade market/side");
        sink.trade(symbol, { time: timestamp(prop(item, "T")), price: priceDecimal(prop(item, "p")), quantity: volumeDecimal(prop(item, "v")), count: 1, takerBuy: side === "Buy" });
      }
    } else if (channel === "tickers") {
      if (prop(data, "symbol") !== symbol) throw new Error("Invalid Bybit ticker market");
      const lastPrice = priceDecimal(prop(data, "lastPrice")), openPrice = priceDecimal(prop(data, "prevPrice24h"));
      const open = Number(openPrice);
      sink.ticker({ symbol, lastPrice, openPrice, highPrice: priceDecimal(prop(data, "highPrice24h")), lowPrice: priceDecimal(prop(data, "lowPrice24h")), volume: volumeDecimal(prop(data, "volume24h")), quoteVolume: volumeDecimal(prop(data, "turnover24h")), changePercent: open > 0 ? Math.round((Number(lastPrice) - open) / open * 1e6) / 1e4 : 0, eventTime: timestamp(prop(value, "ts")) });
    }
  } catch (error) { sink.invalid(String(error)); }
}

export const bybit: Venue = {
  id: "bybit", label: "Bybit", coinGeckoId: "bybit_spot",
  history: ["1m"], fields: { quoteVolume: true, trades: false, takerBuy: false }, parityIntervals: Object.keys(intervals),
  // Public IP limit: 600 requests / 5 s; 600/min is well below half.
  // https://bybit-exchange.github.io/docs/v5/rate-limit
  defaults: { restUrl: "https://api.bybit.com", streamUrl: "wss://stream.bybit.com/v5/public/spot", budget: 600 },
  symbol: (base, quote) => `${base}${quote}`.toUpperCase(),
  rest: options => createBybitRest(options),
  live: options => ({
    open(symbols, sink) {
      const unique = [...new Set(symbols)], sockets: { close(): void }[] = [], connected = new Set<number>();
      // Ten arguments per spot subscription; five pairs per socket also bounds connection topics.
      const count = Math.ceil(unique.length / 5);
      for (let offset = 0; offset < unique.length; offset += 5) {
        const group = unique.slice(offset, offset + 5), allowed = new Set(group), id = offset;
        sockets.push(openSocket({
          venue: "bybit", url: () => options.streamUrl,
          onOpen: send => send(JSON.stringify({ op: "subscribe", args: group.flatMap(symbol => [`publicTrade.${symbol}`, `tickers.${symbol}`]) })),
          onMessage: message => {
            try { handleBybitFrame(JSON.parse(message), allowed, sink); } catch (error) { sink.invalid(String(error)); }
          },
          onConnected: state => { if (state) connected.add(id); else connected.delete(id); sink.connected(connected.size === count); },
          ping: { message: JSON.stringify({ op: "ping" }), everyMs: 20_000 },
        }));
      }
      return { close() { for (const socket of sockets) socket.close(); } };
    },
  }),
};
