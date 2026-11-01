import type { Kline, Resolution } from "../candles/kline";
import type { Ticker } from "../live/protocol";
import type { HttpOptions } from "./http";
import type { LiveSink, Trade, Venue, VenueOptions, VenueRest } from "./types";
import { DAY, HOUR, MINUTE, kline, priceDecimal, volumeDecimal } from "../candles/kline";
import { prop } from "../json";
import { VenueHttp } from "./http";
import { openSocket } from "./socket";

const intervals: Record<string, [string, number]> = { "1m": ["1m", MINUTE], "5m": ["5m", 5 * MINUTE], "15m": ["15m", 15 * MINUTE], "30m": ["30m", 30 * MINUTE], "1h": ["60m", HOUR], "4h": ["4h", 4 * HOUR], "1d": ["1d", DAY] };
const clients = new WeakMap<VenueRest, VenueHttp>();
type Dependencies = Pick<HttpOptions, "fetcher" | "now" | "sleep">;

function checked(value: unknown): unknown {
  const code = prop(value, "code");
  if (code !== undefined && code !== 0) throw new Error(`MEXC ${String(code)}: ${String(prop(value, "msg"))}`);
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length) throw new Error("Invalid MEXC string");
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid MEXC timestamp");
  return value;
}

export function createMexcRest(options: VenueOptions, deps: Dependencies = {}): VenueRest {
  const http = new VenueHttp({ venue: "mexc", url: options.restUrl, budget: options.budget, ...deps });
  const now = deps.now ?? Date.now;
  async function page(symbol: string, interval: string, from: number, to: number): Promise<{ klines: Kline[]; coveredTo: number }> {
    const spec = intervals[interval];
    if (!spec || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || from >= to) throw new Error("Invalid MEXC candle range");
    // The API silently caps limit=1000 at 500. Old starts can return newest candles.
    if (interval === "1m") {
      const retentionBound = Math.ceil((now() - 30 * DAY + 5 * MINUTE) / MINUTE) * MINUTE;
      if (from < retentionBound) return { klines: [], coveredTo: Math.min(to, retentionBound) };
    }
    const coveredTo = Math.min(to, from + 500 * spec[1]);
    const data = checked(await http.get(`/api/v3/klines?${new URLSearchParams({ symbol, interval: spec[0], startTime: String(from), endTime: String(coveredTo - 1), limit: "500" })}`));
    if (!Array.isArray(data)) throw new Error("Invalid MEXC candles");
    const bars = new Map<number, Kline>();
    for (const row of data) {
      if (!Array.isArray(row) || row.length < 8) throw new Error("Invalid MEXC candle row");
      const openTime = timestamp(row[0]);
      // Never admit the newest-page fallback into an older requested window.
      if (openTime < from || openTime >= coveredTo) continue;
      const bar = kline({ openTime, open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5], quoteVolume: row[7], trades: 0, takerBuyVolume: "0", takerBuyQuoteVolume: "0" }, interval === "1d" ? "1d" : interval === "1h" ? "1h" : "1m");
      if (openTime % spec[1]) throw new Error("Misaligned MEXC candle");
      bars.set(openTime, bar);
    }
    return { klines: [...bars.values()].sort((a, b) => a.openTime - b.openTime), coveredTo };
  }
  async function firstDay(symbol: string, utcOnly: boolean): Promise<number | null> {
    let end = Math.floor(now() / DAY) * DAY;
    let oldest: number | null = null;
    // Daily and hourly history reaches listing; walk bounded daily pages backwards.
    while (end > Date.UTC(2017, 0, 1)) {
      const start = Math.max(Date.UTC(2017, 0, 1), end - 500 * DAY);
      const data = checked(await http.get(`/api/v3/klines?${new URLSearchParams({ symbol, interval: "1d", startTime: String(start), endTime: String(end - 1), limit: "500" })}`));
      if (!Array.isArray(data)) throw new Error("Invalid MEXC daily discovery");
      const times = data.map(row => {
        if (!Array.isArray(row) || row.length < 8) throw new Error("Invalid MEXC daily discovery row");
        return timestamp(row[0]);
      }).filter(time => time >= start && time < end).sort((a, b) => a - b);
      if (!times.length && oldest !== null) return oldest;
      // Old BTC daily bars used UTC+8; hourly history can cover those dates without shifting buckets.
      const usable = utcOnly ? times.filter(time => time % DAY === 0) : times;
      if (usable.length) oldest = Math.floor(usable[0]! / DAY) * DAY;
      if (utcOnly && times.some(time => time % DAY !== 0)) return oldest;
      end = start;
    }
    return oldest;
  }
  const rest: VenueRest = {
    async instruments() {
      const data = checked(await http.get("/api/v3/exchangeInfo"));
      const rows = prop(data, "symbols");
      if (!Array.isArray(rows)) throw new Error("Invalid MEXC instruments");
      return rows.map(row => ({ symbol: text(prop(row, "symbol")), base: text(prop(row, "baseAsset")), quote: text(prop(row, "quoteAsset")), status: prop(row, "status") === "1" && prop(row, "isSpotTradingAllowed") === true ? "TRADING" : text(prop(row, "status")) }));
    },
    candles: page,
    async earliest(symbol: string, resolution: Resolution) {
      if (resolution === "1m") {
        // Measured on BTC/COCA: a rolling 30-day minute window; five minutes avoids expiry in flight.
        const from = Math.ceil((now() - 30 * DAY + 5 * MINUTE) / MINUTE) * MINUTE;
        const end = Math.floor(now() / MINUTE) * MINUTE;
        for (let start = from; start < end;) {
          const result = await page(symbol, resolution, start, end);
          if (result.klines.length) return result.klines[0]!.openTime;
          start = result.coveredTo;
        }
        return null;
      }
      const day = await firstDay(symbol, resolution === "1d");
      if (day === null || resolution === "1d") return day;
      // Some migrated markets have daily bars older than their hourly archive.
      const end = Math.floor(now() / HOUR) * HOUR;
      for (let start = day; start < end;) {
        const result = await page(symbol, resolution, start, end);
        if (result.klines.length) return result.klines[0]!.openTime;
        start = result.coveredTo;
      }
      return null;
    },
    async nativeCandles(symbol, interval, from, to) {
      const klines: Kline[] = [];
      let start = from;
      do {
        const result = await page(symbol, interval, start, to);
        for (const bar of result.klines) {
          klines.push(bar);
          if (klines.length === 1000) return klines;
        }
        start = result.coveredTo;
      } while (start < to);
      return klines;
    },
  };
  clients.set(rest, http);
  return rest;
}

// Official schema: github.com/mexcdevelop/websocket-proto (wrapper 314, deals 1).
// Only varint and length-delimited fields occur in these messages. Reject malformed frames.
type Field = { id: number; value: number | Uint8Array };
function protobuf(bytes: Uint8Array): Field[] {
  let offset = 0;
  function integer(): number {
    let value = 0, scale = 1;
    for (let i = 0; i < 8; i++) {
      const byte = bytes[offset++];
      if (byte === undefined) throw new Error("Truncated MEXC protobuf varint");
      value += (byte & 127) * scale;
      if (!(byte & 128)) {
        if (!Number.isSafeInteger(value)) throw new Error("Oversized MEXC protobuf integer");
        return value;
      }
      scale *= 128;
    }
    throw new Error("Oversized MEXC protobuf varint");
  }
  const fields: Field[] = [];
  while (offset < bytes.length) {
    const key = integer(), wire = key % 8, id = Math.floor(key / 8);
    if (!id) throw new Error("Invalid MEXC protobuf field");
    if (wire === 0) fields.push({ id, value: integer() });
    else if (wire === 2) {
      const size = integer();
      if (size > bytes.length - offset) throw new Error("Truncated MEXC protobuf field");
      fields.push({ id, value: bytes.subarray(offset, offset + size) });
      offset += size;
    } else throw new Error("Unsupported MEXC protobuf wire type");
  }
  return fields;
}
const decoder = new TextDecoder("utf-8", { fatal: true });
function field(fields: Field[], id: number): number | Uint8Array | undefined { return fields.find(item => item.id === id)?.value; }
function stringField(fields: Field[], id: number): string {
  const value = field(fields, id);
  if (!(value instanceof Uint8Array)) throw new Error("Missing MEXC protobuf string");
  return text(decoder.decode(value));
}
export function parseMexcDeals(bytes: Uint8Array): { symbol: string; trades: Trade[] } {
  const wrapper = protobuf(bytes), symbol = stringField(wrapper, 3), channel = stringField(wrapper, 1);
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(symbol) || channel !== `spot@public.aggre.deals.v3.api.pb@100ms@${symbol}`) throw new Error("Invalid MEXC deals channel");
  const body = field(wrapper, 314);
  if (!(body instanceof Uint8Array)) throw new Error("Missing MEXC deals body");
  const fields = protobuf(body);
  const event = stringField(fields, 2);
  if (event !== "spot@public.aggre.deals.v3.api.pb@100ms") return { symbol, trades: [] };
  const trades: Trade[] = [];
  for (const item of fields) {
    if (item.id !== 1) continue;
    if (!(item.value instanceof Uint8Array)) throw new Error("Invalid MEXC deal");
    const deal = protobuf(item.value), side = field(deal, 3);
    if (side !== 1 && side !== 2) throw new Error("Invalid MEXC deal side");
    trades.push({ time: timestamp(field(deal, 4)), price: priceDecimal(stringField(deal, 1)), quantity: volumeDecimal(stringField(deal, 2)), count: 1, takerBuy: side === 1 });
  }
  return { symbol, trades };
}
export function parseMexcTicker(data: unknown): Ticker {
  checked(data);
  const symbol = text(prop(data, "symbol")), lastPrice = priceDecimal(prop(data, "lastPrice")), openPrice = priceDecimal(prop(data, "openPrice"));
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(symbol)) throw new Error("Invalid MEXC ticker symbol");
  const open = Number(openPrice);
  return { symbol, lastPrice, openPrice, highPrice: priceDecimal(prop(data, "highPrice")), lowPrice: priceDecimal(prop(data, "lowPrice")), volume: volumeDecimal(prop(data, "volume")), quoteVolume: volumeDecimal(prop(data, "quoteVolume")), eventTime: timestamp(prop(data, "closeTime")), changePercent: open ? Math.round((Number(lastPrice) - open) / open * 1e6) / 1e4 : 0 };
}

export const mexc: Venue = {
  id: "mexc", label: "MEXC", coinGeckoId: "mxc", history: ["1m", "1h", "1d"], fields: { quoteVolume: true, trades: false, takerBuy: false },
  parityIntervals: Object.keys(intervals).filter(interval => interval !== "1d"),
  // IP limit: 300 weight / 10s. Budget 30/min remains below half even at exchangeInfo's weight 25.
  // https://www.mexc.com/api-docs#rate-limit-description
  defaults: { restUrl: "https://api.mexc.com", streamUrl: "wss://wbs-api.mexc.com/ws", budget: 30 },
  symbol: (base, quote) => `${base}${quote}`.toUpperCase(),
  rest: options => createMexcRest(options),
  live(options, rest) {
    const http = clients.get(rest) ?? new VenueHttp({ venue: "mexc", url: options.restUrl, budget: options.budget });
    return { open(symbols: readonly string[], sink: LiveSink) {
      let stopped = false, timer: Timer | undefined;
      const wanted = new Set(symbols), connected = new Set<number>();
      const sockets: { close(): void }[] = [];
      for (let offset = 0; offset < symbols.length; offset += 30) {
        const group = symbols.slice(offset, offset + 30), index = sockets.length;
        sockets.push(openSocket({ venue: "mexc", url: () => options.streamUrl,
          onOpen(send) { send(JSON.stringify({ method: "SUBSCRIPTION", params: group.map(symbol => `spot@public.aggre.deals.v3.api.pb@100ms@${symbol}`) })); },
          onConnected(state) { if (state) connected.add(index); else connected.delete(index); if (!stopped) sink.connected(connected.size === sockets.length); },
          onMessage(message) { try { const data: unknown = JSON.parse(message); checked(data); } catch (error) { sink.invalid(String(error)); } },
          onBinary(bytes) { try { const data = parseMexcDeals(bytes); if (!wanted.has(data.symbol)) throw new Error("Unsubscribed MEXC symbol"); for (const trade of data.trades) sink.trade(data.symbol, trade); } catch (error) { sink.invalid(String(error)); } },
          ping: { message: '{"method":"PING"}', everyMs: 15_000 }, idleMs: 60_000, maxAgeMs: 23 * HOUR,
        }));
      }
      // Protobuf miniTicker rates are UTC+8/zoned, not rolling 24h. REST carries the true rolling open.
      async function poll() {
        for (const symbol of symbols) {
          if (stopped) return;
          try { const ticker = parseMexcTicker(await http.get(`/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`)); if (!stopped) sink.ticker(ticker); }
          catch (error) { if (!stopped) sink.invalid(String(error)); }
        }
        if (!stopped) timer = setTimeout(() => void poll(), 2000);
      }
      if (symbols.length) void poll();
      return { close() { stopped = true; clearTimeout(timer); for (const socket of sockets) socket.close(); sink.connected(false); } };
    } };
  },
};
