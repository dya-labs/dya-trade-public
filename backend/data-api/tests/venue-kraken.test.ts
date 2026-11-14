import { describe, expect, test, vi } from "bun:test";
import type { LiveSink, Trade } from "../src/venues/types";
import type { Ticker } from "../src/live/protocol";
import { createKrakenRest, kraken, parseKrakenFrame } from "../src/venues/kraken";
import { ClickHouse } from "../src/clickhouse";

// Kraken ignores our stores; the venue contract still passes them.
const unusedContext = { clickhouse: new ClickHouse({ url: "http://127.0.0.1:9", user: "", password: "", database: "unused" }), redisUrl: "redis://127.0.0.1:9", intentsExplorerJwt: undefined, neardata: { url: "https://neardata.invalid", apiKey: undefined } };

// Recorded /Trades?pair=SWEATUSD&since=0&count=2; precision edge cases below mutate this shape.
const first = ["0.0025940000", "32744.79568", 1751467169.6685348, "b", "m", "", 1];
const second = ["0.0025940000", "1931.38010", 1751467195.8263955, "b", "l", "", 2];
function harness(payloads: unknown[]) {
  let now = 0; const urls: string[] = [], sleeps: number[] = [];
  const rest = createKrakenRest(kraken.defaults, { now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; }, fetcher: (async (url: string | URL | Request) => { urls.push(String(url)); if (!payloads.length) throw new Error("Unexpected request"); return Response.json(payloads.shift()); }) as typeof fetch });
  return { rest, urls, sleeps };
}
function envelope(rows: unknown[], last = "1751467195826395624") { return { error: [], result: { SWEATUSD: rows, last } }; }
function sink() {
  const trades: Trade[] = [], tickers: Ticker[] = [], errors: string[] = [];
  const value: LiveSink = { trade: (_symbol, trade) => { trades.push(trade); }, ticker: ticker => { tickers.push(ticker); }, connected: () => {}, invalid: detail => { errors.push(detail); } };
  return { value, trades, tickers, errors };
}
describe("Kraken", () => {
  test("builds exact trade candles, aligns fractional timestamps, and finds listing", async () => {
    const h = harness([envelope([first, second]), envelope([first])]);
    const from = 1751467140000;
    const result = await h.rest.candles("SWEATUSD", "1m", from, from + 120000);
    expect(result.coveredTo).toBe(from + 120000);
    expect(result.klines).toEqual([{ openTime: from, open: "0.002594", high: "0.002594", low: "0.002594", close: "0.002594", volume: "34676.17578", quoteVolume: "89.94999997", trades: 2, takerBuyVolume: "34676.17578", takerBuyQuoteVolume: "89.94999997" }]);
    expect(await h.rest.earliest("SWEATUSD", "1m")).toBe(from);
    expect(h.urls[1]).toContain("since=0&count=1");
  });
  test("retains tiny prices and sums raw quantities before volume truncation", async () => {
    const h = harness([envelope([["0.00000000123", "1.123456789", "120.9999999", "b", "l", "", 1], ["0.00000000124", "2.123456789", "121", "s", "l", "", 2], ["0.00000000122", "1", "180", "b", "l", "", 3]])]);
    const { klines } = await h.rest.candles("SWEATUSD", "1m", 120000, 240000);
    expect(klines.map(bar => bar.openTime)).toEqual([120000, 180000]);
    expect(klines[0]).toMatchObject({ open: "0.00000000123", close: "0.00000000124", high: "0.00000000124", volume: "3.24691357", takerBuyVolume: "1.12345678", quoteVolume: "0", trades: 2 });
  });
  test("drops the trailing partial minute on a full page", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ["2", "1", i < 999 ? 120 : 180, "b", "l", "", i]);
    const h = harness([envelope(rows)]);
    const page = await h.rest.candles("SWEATUSD", "1m", 120000, 300000);
    expect(page.coveredTo).toBe(180000);
    expect(page.klines).toHaveLength(1);
    expect(page.klines[0]?.trades).toBe(999);
  });
  test("pages through a minute containing over 1000 trades", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ["2", "1", 120 + i / 1000, "b", "l", "", i]);
    const h = harness([envelope(rows, "120999000000"), envelope([["3", "1", 121, "s", "l", "", 1000]], "121000000000")]);
    const page = await h.rest.candles("SWEATUSD", "1m", 120000, 180000);
    expect(page.coveredTo).toBe(180000); expect(page.klines[0]?.trades).toBe(1001);
    expect(h.urls[1]).toContain("since=120999000000");
  });
  test("empty ranges progress and empty listing is null", async () => {
    const h = harness([envelope([]), envelope([])]);
    expect(await h.rest.candles("SWEATUSD", "1m", 60000, 900000)).toEqual({ coveredTo: 900000, klines: [] });
    expect(await h.rest.earliest("SWEATUSD", "1m")).toBeNull();
  });
  test("rejects HTTP-200 error envelopes and pauses after rate limits", async () => {
    const h = harness([{ error: ["EAPI:Rate limit exceeded"] }, envelope([]), { error: ["EQuery:Unknown asset pair"] }]);
    await expect(h.rest.earliest("SWEATUSD", "1m")).rejects.toThrow("Rate limit");
    expect(await h.rest.earliest("SWEATUSD", "1m")).toBeNull();
    expect(h.sleeps).toContain(60000);
    await expect(h.rest.earliest("BAD", "1m")).rejects.toThrow("Unknown asset pair");
  });
  test("native OHLC excludes the current row and derives turnover from VWAP", async () => {
    const row = [120, "0.00000000123", "0.00000000124", "0.00000000122", "0.00000000123", "0.00000000123", "10000000.123456789", 3];
    const h = harness([envelope([row, [180, ...row.slice(1)]])]);
    const bars = await h.rest.nativeCandles("SWEATUSD", "1m", 120000, 240000);
    expect(bars).toHaveLength(1); expect(bars[0]).toMatchObject({ volume: "10000000.12345678", quoteVolume: "0.0123", trades: 3, takerBuyVolume: "0" });
  });
  test("reads display assets and online status", async () => {
    const h = harness([{ error: [], result: { SWEATUSD: { altname: "SWEATUSD", wsname: "SWEAT/USD", base: "SWEAT", quote: "ZUSD", status: "online" } } }]);
    expect(await h.rest.instruments()).toEqual([{ symbol: "SWEATUSD", base: "SWEAT", quote: "USD", status: "TRADING" }]);
  });
  test("ignores trade snapshots, parses live microseconds, catches malformed frames", () => {
    const s = sink(), symbols = new Map([["SWEAT/USD", "SWEATUSD"]]);
    const row = { symbol: "SWEAT/USD", price: 1.23e-9, qty: 1.123456789, side: "buy", timestamp: "2025-07-02T12:00:00.123456Z", trade_id: 1 };
    parseKrakenFrame({ channel: "trade", type: "snapshot", data: [row] }, symbols, s.value);
    expect(s.trades).toHaveLength(0);
    parseKrakenFrame({ channel: "trade", type: "update", data: [row, { ...row, side: "sell", trade_id: 2 }] }, symbols, s.value);
    expect(s.trades).toEqual([{ time: Date.parse(row.timestamp), price: "0.00000000123", quantity: "1.12345678", count: 1, takerBuy: true }, { time: Date.parse(row.timestamp), price: "0.00000000123", quantity: "1.12345678", count: 1, takerBuy: false }]);
    parseKrakenFrame({ channel: "trade", type: "update", data: [{ ...row, side: "?" }] }, symbols, s.value);
    expect(s.errors).toHaveLength(1);
  });
  test("derives exact open and quote volume in rolling tickers", () => {
    const s = sink();
    parseKrakenFrame({ channel: "ticker", type: "snapshot", data: [{ symbol: "SWEAT/USD", last: 0.002594, change: -0.000006, high: 0.003, low: 0.002, volume: 123456.123456789, vwap: 0.0025 }] }, new Map([["SWEAT/USD", "SWEATUSD"]]), s.value, () => 123);
    expect(s.errors).toEqual([]);
    expect(s.tickers[0]).toEqual({ symbol: "SWEATUSD", lastPrice: "0.002594", openPrice: "0.0026", highPrice: "0.003", lowPrice: "0.002", volume: "123456.12345678", quoteVolume: "308.64030864", changePercent: -0.2308, eventTime: 123 });
  });
  test("parses live-observed SWEAT values in reconstructed WS envelopes", () => {
    const s = sink(), symbols = new Map([["SWEAT/USD", "SWEATUSD"]]);
    // Values captured by the live sink; envelope metadata/trade_id are synthetic.
    parseKrakenFrame({ channel: "trade", type: "update", data: [{ symbol: "SWEAT/USD", price: 0.000117, qty: 545096.46664, side: "buy", timestamp: "2026-10-12T22:40:26.082000Z", trade_id: 260735 }] }, symbols, s.value);
    parseKrakenFrame({ channel: "ticker", type: "update", data: [{ symbol: "SWEAT/USD", last: 0.000117, change: -0.000035, high: 0.000155, low: 0.00011, volume: 393601731.96505, vwap: 0.000128 }] }, symbols, s.value, () => 1791844826109);
    expect(s.errors).toEqual([]);
    expect(s.trades[0]).toMatchObject({ time: 1791844826082, price: "0.000117", quantity: "545096.46664", takerBuy: true });
    expect(s.tickers[0]).toMatchObject({ openPrice: "0.000152", quoteVolume: "50381.02169152", changePercent: -23.0263 });
  });
  test("retries failed instrument discovery and opens both live subscriptions", async () => {
    const subscribed = Promise.withResolvers<void>(), channels: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request, server) {
        if (server.upgrade(request)) return;
        return new Response("WebSocket required", { status: 400 });
      },
      websocket: {
        message(_socket, message) {
          const data: unknown = JSON.parse(String(message));
          if (typeof data !== "object" || data === null || !("params" in data)) return;
          const params = data.params;
          if (typeof params !== "object" || params === null || !("channel" in params) || typeof params.channel !== "string") return;
          channels.push(params.channel);
          if (channels.length === 2) subscribed.resolve();
        },
      },
    });
    let attempts = 0;
    const rest = {
      ...createKrakenRest(kraken.defaults),
      async instruments() {
        if (++attempts === 1) throw new Error("temporary discovery failure");
        return [{ symbol: "SWEATUSD", base: "SWEAT", quote: "USD", status: "TRADING" }];
      },
    };
    const s = sink(), states: boolean[] = [], failed = Promise.withResolvers<void>();
    vi.useFakeTimers();
    const stream = kraken.live({ ...kraken.defaults, streamUrl: `ws://127.0.0.1:${server.port}` }, rest, unusedContext).open(["SWEATUSD"], {
      ...s.value, connected: state => { states.push(state); },
      invalid: detail => { s.errors.push(detail); failed.resolve(); },
    });
    try {
      await failed.promise;
      vi.advanceTimersByTime(1000);
      vi.useRealTimers();
      await subscribed.promise;
      expect(attempts).toBe(2);
      expect(channels).toEqual(["trade", "ticker"]);
      expect(states).toEqual([false, true]);
      expect(s.errors).toEqual(["Error: temporary discovery failure"]);
    } finally {
      vi.useRealTimers();
      stream.close();
      server.stop(true);
    }
  });
  test("close cancels discovery retries", async () => {
    let attempts = 0;
    vi.useFakeTimers();
    const failed = Promise.withResolvers<void>(), s = sink();
    const rest = {
      ...createKrakenRest(kraken.defaults),
      async instruments() { attempts++; throw new Error("temporary discovery failure"); },
    };
    const stream = kraken.live(kraken.defaults, rest, unusedContext).open(["SWEATUSD"], {
      ...s.value, invalid: () => { failed.resolve(); },
    });
    try {
      await failed.promise;
      stream.close();
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
      expect(attempts).toBe(1);
    } finally {
      stream.close();
      vi.useRealTimers();
    }
  });
});
