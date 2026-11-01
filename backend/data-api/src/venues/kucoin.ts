import type { Kline } from "../candles/kline";
import type { HttpOptions } from "./http";
import type { LiveSink, Venue, VenueOptions, VenueRest } from "./types";
import { DAY, HOUR, MINUTE, kline, numberDecimal, priceDecimal, volumeDecimal } from "../candles/kline";
import { prop } from "../json";
import { VenueHttp } from "./http";
import { openSocket } from "./socket";

const intervals: Record<string, { name: string; ms: number }> = {
  "1m": { name: "1min", ms: MINUTE }, "3m": { name: "3min", ms: 3 * MINUTE },
  "5m": { name: "5min", ms: 5 * MINUTE }, "15m": { name: "15min", ms: 15 * MINUTE },
  "30m": { name: "30min", ms: 30 * MINUTE }, "1h": { name: "1hour", ms: HOUR },
  "2h": { name: "2hour", ms: 2 * HOUR }, "4h": { name: "4hour", ms: 4 * HOUR },
  "6h": { name: "6hour", ms: 6 * HOUR }, "8h": { name: "8hour", ms: 8 * HOUR },
  "12h": { name: "12hour", ms: 12 * HOUR }, "1d": { name: "1day", ms: DAY },
  "1M": { name: "1month", ms: 28 * DAY },
};

function data(value: unknown): unknown {
  if (prop(value, "code") !== "200000") throw new Error(`KuCoin API ${String(prop(value, "code"))}: ${String(prop(value, "msg"))}`);
  return prop(value, "data");
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length) throw new Error("Invalid KuCoin string");
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid KuCoin timestamp");
  return value;
}
function decimal(value: unknown): string { return typeof value === "number" ? numberDecimal(value) : text(value); }

const clients = new WeakMap<VenueRest, VenueHttp>();

/** Token POST shares candle pacing and HTTP backoff; its weight 10 reserves three weight-4 slots. */
export async function fetchKucoinToken(rest: VenueRest): Promise<unknown> {
  const http = clients.get(rest);
  if (!http) throw new Error("KuCoin live requires a KuCoin REST client");
  return data(await http.post("/api/v1/bullet-public", 3));
}
/** Candles weigh 3 and symbols weigh 4 against the public 2000/30s pool; 450/min stays below half even at weight 4. */
export function createKucoinRest(options: VenueOptions, deps: Pick<HttpOptions, "fetcher" | "now" | "sleep"> = {}): VenueRest {
  const http = new VenueHttp({ venue: "kucoin", url: options.restUrl, budget: options.budget, ...deps });
  const now = deps.now ?? Date.now;
  async function page(symbol: string, interval: string, from: number, to: number, limit: number) {
    const spec = intervals[interval];
    if (!spec) throw new Error(`Unsupported KuCoin interval: ${interval}`);
    const coveredTo = Math.min(to, from + limit * spec.ms);
    if (coveredTo <= from) throw new Error("Invalid KuCoin candle range");
    const query = new URLSearchParams({ symbol, type: spec.name, startAt: String(Math.floor(from / 1000)), endAt: String(Math.ceil(coveredTo / 1000) - 1) });
    const rows = data(await http.get(`/api/v1/market/candles?${query}`));
    if (!Array.isArray(rows)) throw new Error("Invalid KuCoin candles");
    const bars = new Map<number, Kline>();
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 7 || typeof row[0] !== "string" || !/^\d+$/.test(row[0])) throw new Error("Invalid KuCoin candle");
      const bar = kline({ openTime: Number(row[0]) * 1000, open: row[1], close: row[2], high: row[3], low: row[4], volume: row[5], quoteVolume: row[6], trades: 0, takerBuyVolume: "0", takerBuyQuoteVolume: "0" });
      if (bar.openTime >= from && bar.openTime < coveredTo) bars.set(bar.openTime, bar);
    }
    return { klines: [...bars.values()].sort((a, b) => a.openTime - b.openTime), coveredTo };
  }
  const rest: VenueRest = {
    async instruments() {
      const rows = data(await http.get("/api/v2/symbols"));
      if (!Array.isArray(rows)) throw new Error("Invalid KuCoin symbols");
      return rows.map(row => {
        const enabled = prop(row, "enableTrading");
        if (typeof enabled !== "boolean") throw new Error("Invalid KuCoin trading status");
        const name = text(prop(row, "name")).split("-");
        return { symbol: text(prop(row, "symbol")), base: name[0] ?? text(prop(row, "baseCurrency")), quote: name[1] ?? text(prop(row, "quoteCurrency")), status: enabled ? "TRADING" : "HALTED" };
      });
    },
    candles: (symbol, resolution, from, to) => page(symbol, resolution, from, to, 1500),
    async earliest(symbol, resolution) {
      // KuCoin launched in September 2017. Walk bounded daily windows, never an over-wide query.
      const end = Math.floor(now() / MINUTE) * MINUTE;
      for (let from = Date.UTC(2017, 8, 1); from < end;) {
        const result = await page(symbol, "1d", from, end, 1500);
        const first = result.klines[0];
        if (first) {
          if (resolution === "1d") return first.openTime;
          const fine = await page(symbol, resolution, first.openTime, Math.min(first.openTime + DAY, end), 1500);
          return fine.klines[0]?.openTime ?? null;
        }
        from = result.coveredTo;
      }
      return null;
    },
    async nativeCandles(symbol, interval, from, to) { return (await page(symbol, interval, from, to, 1000)).klines; },
  };
  clients.set(rest, http);
  return rest;
}

/** Dispatches only live match events; snapshot is a ticker channel, never a trade replay. */
export function handleKucoinFrame(frame: unknown, sink: LiveSink): void {
  try {
    const type = prop(frame, "type");
    if (type === "welcome" || type === "ack" || type === "pong") return;
    if (type === "snapshot") return;
    if (type !== "message") throw new Error(`Invalid KuCoin frame type: ${String(type)}`);
    const topic = text(prop(frame, "topic"));
    const body = prop(frame, "data");
    if (topic.startsWith("/market/match:")) {
      if (prop(body, "type") === "snapshot" || prop(frame, "subject") === "trade.snapshot") return;
      if (prop(frame, "subject") !== "trade.l3match" || prop(body, "type") !== "match") throw new Error("Invalid KuCoin match");
      const symbol = text(prop(body, "symbol")), side = prop(body, "side"), nanos = text(prop(body, "time"));
      if (topic !== `/market/match:${symbol}` || (side !== "buy" && side !== "sell") || !/^\d+$/.test(nanos)) throw new Error("Invalid KuCoin trade metadata");
      sink.trade(symbol, { time: integer(Number(BigInt(nanos) / 1_000_000n)), price: priceDecimal(prop(body, "price")), quantity: volumeDecimal(prop(body, "size")), count: 1, takerBuy: side === "buy" });
    } else if (topic.startsWith("/market/snapshot:")) {
      if (prop(frame, "subject") !== "trade.snapshot") throw new Error("Invalid KuCoin ticker subject");
      const stats = prop(body, "data"), symbol = text(prop(stats, "symbol"));
      if (topic !== `/market/snapshot:${symbol}`) throw new Error("Invalid KuCoin ticker symbol");
      const lastPrice = priceDecimal(decimal(prop(stats, "lastTradedPrice"))), openPrice = priceDecimal(decimal(prop(stats, "open")));
      sink.ticker({
        symbol, lastPrice, openPrice, highPrice: priceDecimal(decimal(prop(stats, "high"))), lowPrice: priceDecimal(decimal(prop(stats, "low"))),
        volume: volumeDecimal(decimal(prop(stats, "vol"))), quoteVolume: volumeDecimal(decimal(prop(stats, "volValue"))),
        changePercent: Number(openPrice) === 0 ? 0 : Math.round((Number(lastPrice) - Number(openPrice)) / Number(openPrice) * 1_000_000) / 10_000,
        eventTime: integer(prop(stats, "datetime")),
      });
    } else throw new Error(`Unknown KuCoin topic: ${topic}`);
  } catch (error) { sink.invalid(String(error)); }
}

export const kucoin: Venue = {
  id: "kucoin", label: "KuCoin", coinGeckoId: "kucoin",
  history: ["1m"], fields: { quoteVolume: true, trades: false, takerBuy: false },
  // Native weeks start Thursday, unlike our Monday buckets. Native months disagree with the
  // sum of KuCoin's own UTC days (CASHCAT-USDT 2026-07: close 0.042 vs 0.0406), so only up to 1d.
  parityIntervals: Object.keys(intervals).filter(interval => interval !== "1M"),
  // No trailing slash: config normalizes URLs, and an unchanged default means "use the token endpoint".
  defaults: { restUrl: "https://api.kucoin.com", streamUrl: "wss://ws-api-spot.kucoin.com", budget: 450 },
  symbol: (base, quote) => `${base.toUpperCase()}-${quote.toUpperCase()}`,
  rest: options => createKucoinRest(options),
  live(options, rest) {
    return {
      open(symbols, sink) {
        const sockets: { close(): void }[] = [], connected = new Set<number>();
        const groups = Math.ceil(symbols.length / 50);
        for (let offset = 0; offset < symbols.length; offset += 50) {
          const group = symbols.slice(offset, offset + 50), id = offset;
          const ping = { message: JSON.stringify({ id: "heartbeat", type: "ping" }), everyMs: 18_000 };
          sockets.push(openSocket({
            venue: "kucoin", ping, idleMs: 60_000, maxAgeMs: 23 * HOUR,
            async url() {
              const result = await fetchKucoinToken(rest), servers = prop(result, "instanceServers");
              if (!Array.isArray(servers) || !servers.length) throw new Error("Invalid KuCoin servers");
              const server: unknown = servers[0];
              ping.everyMs = integer(prop(server, "pingInterval"));
              if (!ping.everyMs) throw new Error("Invalid KuCoin ping interval");
              const endpoint = options.streamUrl === kucoin.defaults.streamUrl ? text(prop(server, "endpoint")) : options.streamUrl;
              const url = new URL(endpoint);
              url.searchParams.set("token", text(prop(result, "token")));
              url.searchParams.set("connectId", crypto.randomUUID());
              return url.toString();
            },
            onOpen(send) {
              // 50 match topics + 50 single-symbol snapshots: below 100/batch, 300/connection, 100 messages/10s.
              send(JSON.stringify({ id: crypto.randomUUID(), type: "subscribe", topic: `/market/match:${group.join(",")}`, response: true }));
              for (const symbol of group) send(JSON.stringify({ id: crypto.randomUUID(), type: "subscribe", topic: `/market/snapshot:${symbol}`, response: true }));
            },
            onMessage(message) {
              try { handleKucoinFrame(JSON.parse(message), sink); } catch (error) { sink.invalid(String(error)); }
            },
            onConnected(value) {
              if (value) connected.add(id); else connected.delete(id);
              sink.connected(connected.size === groups);
            },
          }));
        }
        return { close() { for (const socket of sockets) socket.close(); } };
      },
    };
  },
};
