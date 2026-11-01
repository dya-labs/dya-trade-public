import type { Kline } from "../candles/kline";
import type { HttpOptions } from "./http";
import type { LiveSink, Venue, VenueOptions, VenueRest } from "./types";
import { DAY, RESOLUTION_MS, kline, priceDecimal, volumeDecimal } from "../candles/kline";
import { prop } from "../json";
import { VenueHttp } from "./http";
import { openSocket } from "./socket";

function text(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid Gate string");
  return value;
}
function timestamp(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+(\.\d+)?$/.test(String(value))) throw new Error("Invalid Gate timestamp");
  const result = Math.floor(Number(value));
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid Gate timestamp");
  return result;
}
function rows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Gate response: ${String(prop(value, "label"))} ${String(prop(value, "message"))}`);
  return value;
}
const intervals: Record<string, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "7d", "1M": "30d" };

export function createGateRest(options: VenueOptions, deps: Pick<HttpOptions, "fetcher" | "now" | "sleep"> = {}): VenueRest {
  const http = new VenueHttp({ venue: "gate", url: options.restUrl, budget: options.budget, ...deps });
  const now = deps.now ?? Date.now;
  const listings = new Map<string, number>();
  async function page(symbol: string, interval: string, from: number, to: number): Promise<Kline[]> {
    const native = intervals[interval];
    if (!native) throw new Error(`Unsupported Gate interval: ${interval}`);
    const query = new URLSearchParams({ currency_pair: symbol, interval: native, from: String(Math.ceil(from / 1000)), to: String(Math.ceil(to / 1000) - 1) });
    const data = rows(await http.get(`/spot/candlesticks?${query}`));
    const result: Kline[] = [];
    for (const row of data) {
      if (!Array.isArray(row) || row.length !== 8 || (row[7] !== "true" && row[7] !== "false")) throw new Error("Invalid Gate candle");
      const openTime = timestamp(row[0]) * 1000;
      if (row[7] === "false" || openTime < from || openTime >= to) continue;
      result.push(kline({ openTime, open: row[5], high: row[3], low: row[4], close: row[2], volume: row[6], quoteVolume: row[1], trades: 0, takerBuyVolume: "0", takerBuyQuoteVolume: "0" }, interval === "1d" ? "1d" : interval === "1h" ? "1h" : "1m"));
    }
    result.sort((a, b) => a.openTime - b.openTime);
    for (let i = 1; i < result.length; i++) if (result[i]!.openTime === result[i - 1]!.openTime) throw new Error("Duplicate Gate candle");
    return result;
  }
  async function listing(symbol: string): Promise<number | null> {
    if (listings.has(symbol)) return listings.get(symbol)!;
    // Daily bars retain the full listing history; minute/hour endpoints have rolling limits.
    const end = Math.floor(now() / DAY) * DAY;
    for (let from = 0; from < end; from += 1000 * DAY) {
      const data = await page(symbol, "1d", from, Math.min(end, from + 1000 * DAY));
      if (data.length) { listings.set(symbol, data[0]!.openTime); return data[0]!.openTime; }
    }
    // A pair listed today can have no closed daily candle yet.
    const current = rows(await http.get(`/spot/candlesticks?${new URLSearchParams({ currency_pair: symbol, interval: "1d", limit: "1" })}`));
    if (current.length) {
      const row = current[0];
      if (!Array.isArray(row)) throw new Error("Invalid Gate listing candle");
      const start = timestamp(row[0]) * 1000;
      listings.set(symbol, start);
      return start;
    }
    return null;
  }
  return {
    async instruments() {
      return rows(await http.get("/spot/currency_pairs")).map(row => ({ symbol: text(prop(row, "id")), base: text(prop(row, "base")), quote: text(prop(row, "quote")), status: prop(row, "trade_status") === "tradable" ? "TRADING" : text(prop(row, "trade_status")) }));
    },
    async candles(symbol, resolution, from, to) {
      if (!(from < to)) throw new Error("Invalid Gate candle range");
      if (resolution !== "1d") {
        const size = RESOLUTION_MS[resolution];
        const retentionBound = Math.max(0, Math.ceil((now() - 9990 * size) / size) * size);
        if (from < retentionBound) return { klines: [], coveredTo: Math.min(to, retentionBound) };
      }
      const coveredTo = Math.min(to, from + 1000 * RESOLUTION_MS[resolution]);
      return { klines: await page(symbol, resolution, from, coveredTo), coveredTo };
    },
    async earliest(symbol, resolution) {
      const start = await listing(symbol);
      if (start === null || resolution === "1d") return start;
      const size = RESOLUTION_MS[resolution];
      const from = Math.max(start, Math.ceil((now() - 9990 * size) / size) * size);
      const data = await page(symbol, resolution, from, Math.min(from + 1000 * size, Math.floor(now() / size) * size));
      return data[0]?.openTime ?? from;
    },
    nativeCandles: page,
  };
}

// Gate only publishes a rounded percentage, not a rolling open. Use fixed-point division
// to preserve tiny-token prices and avoid exponent notation / binary floating-point artifacts.
function inferredOpen(last: string, percent: unknown): string {
  const value = text(percent);
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error("Invalid Gate change percentage");
  const [whole = "", fraction = ""] = value.replace("-", "").split(".");
  const scale = 10n ** BigInt(fraction.length);
  const change = BigInt(whole + fraction) * (value.startsWith("-") ? -1n : 1n);
  const divisor = 100n * scale + change;
  if (divisor <= 0n) throw new Error("Invalid Gate change denominator");
  const [integer = "", decimals = ""] = last.split(".");
  const units = BigInt(integer + decimals.padEnd(18, "0"));
  const open = (units * 100n * scale + divisor / 2n) / divisor;
  return priceDecimal(`${open / 10n ** 18n}.${(open % 10n ** 18n).toString().padStart(18, "0")}`);
}

/** Parse only live updates; subscribe acknowledgements are not trade snapshots. */
export function parseGateFrame(frame: unknown, sink: LiveSink): void {
  try {
    if (prop(frame, "error")) throw new Error(`Gate stream error: ${JSON.stringify(prop(frame, "error"))}`);
    if (prop(frame, "event") !== "update") return;
    const channel = prop(frame, "channel"), data = prop(frame, "result");
    if (channel === "spot.trades") {
      const side = prop(data, "side");
      if (side !== "buy" && side !== "sell") throw new Error("Invalid Gate trade side");
      sink.trade(text(prop(data, "currency_pair")), { time: timestamp(prop(data, "create_time_ms")), price: priceDecimal(prop(data, "price")), quantity: volumeDecimal(prop(data, "amount")), count: 1, takerBuy: side === "buy" });
    } else if (channel === "spot.tickers") {
      const lastPrice = priceDecimal(prop(data, "last"));
      const exactOpen = prop(data, "open");
      const openPrice = exactOpen === undefined ? inferredOpen(lastPrice, prop(data, "change_percentage")) : priceDecimal(exactOpen);
      const open = Number(openPrice);
      sink.ticker({ symbol: text(prop(data, "currency_pair")), lastPrice, openPrice, highPrice: priceDecimal(prop(data, "high_24h")), lowPrice: priceDecimal(prop(data, "low_24h")), volume: volumeDecimal(prop(data, "base_volume")), quoteVolume: volumeDecimal(prop(data, "quote_volume")), changePercent: open > 0 ? Math.round((Number(lastPrice) - open) / open * 1e6) / 1e4 : 0, eventTime: prop(frame, "time_ms") === undefined ? timestamp(prop(frame, "time")) * 1000 : timestamp(prop(frame, "time_ms")) });
    }
  } catch (error) { sink.invalid(String(error)); }
}

export const gate: Venue = {
  id: "gate", label: "Gate", coinGeckoId: "gate",
  history: ["1m", "1h", "1d"], fields: { quoteVolume: true, trades: false, takerBuy: false },
  // Live API observations: 7d starts Monday UTC; 30d starts the calendar month, not an epoch 30-day grid.
  parityIntervals: Object.keys(intervals),
  // Public limit: 200 requests / 10 seconds / endpoint / IP; use half, shared across endpoints.
  // https://www.gate.com/help/guide/faq/17521
  defaults: { restUrl: "https://api.gateio.ws/api/v4", streamUrl: "wss://api.gateio.ws/ws/v4/", budget: 600 },
  symbol: (base, quote) => `${base}_${quote}`,
  rest: options => createGateRest(options),
  live: options => ({
    open(symbols, sink) {
      const states: boolean[] = [];
      const sockets: { close(): void }[] = [];
      // Keep each subscription conservatively below public topic limits.
      for (let offset = 0; offset < symbols.length; offset += 50) {
        const payload = symbols.slice(offset, offset + 50), index = states.length;
        states.push(false);
        sockets.push(openSocket({ venue: "gate", url: () => options.streamUrl,
          onOpen(send) { for (const channel of ["spot.trades", "spot.tickers"]) send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel, event: "subscribe", payload })); },
          onMessage(raw) { try { parseGateFrame(JSON.parse(raw), sink); } catch (error) { sink.invalid(String(error)); } },
          onConnected(value) { states[index] = value; sink.connected(states.every(Boolean)); },
          ping: { message: JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.ping" }), everyMs: 15_000 },
        }));
      }
      return { close() { for (const socket of sockets) socket.close(); sink.connected(false); } };
    },
  }),
};
