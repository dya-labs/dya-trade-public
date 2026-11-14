import { describe, expect, test } from "bun:test";
import type { LiveSink, Trade } from "../src/venues/types";
import type { Ticker } from "../src/live/protocol";
import { DAY, MINUTE } from "../src/candles/kline";
import { createSafeTradeRest, parseSafeTradeFrame, safetrade } from "../src/venues/safetrade";

// Recorded from /markets/pearlusdt/k-line (2026-11-08): [openTime s, open, high, low, close, base volume].
const T = 1794134400;
const recorded = [[T, "1.78", "1.78", "1.78", "1.78", "400.6"], [T + 60, "1.78", "1.78", "1.77", "1.78", "3969.9274"]];
function fixture(responses: unknown[], clock = (T + 600) * 1000) {
  const urls: URL[] = [];
  let time = clock;
  const fetcher = (async (input: string | URL | Request) => {
    urls.push(new URL(String(input)));
    if (!responses.length) throw new Error("Unexpected SafeTrade request");
    return Response.json(responses.shift());
  }) as typeof fetch;
  return { urls, rest: createSafeTradeRest(safetrade.defaults, { fetcher, now: () => time, sleep: async ms => { time += ms; } }) };
}
function sinkFixture() {
  const trades: { symbol: string; trade: Trade }[] = [], tickers: Ticker[] = [], errors: string[] = [];
  const sink: LiveSink = { trade: (symbol, trade) => trades.push({ symbol, trade }), ticker: ticker => tickers.push(ticker), invalid: error => errors.push(error), connected() {} };
  return { sink, trades, tickers, errors };
}

describe("SafeTrade candles", () => {
  test("requests a window the limit fully covers and keeps only traded bars inside it", async () => {
    const before = [T - 60, "1.79", "1.79", "1.79", "1.79", "1"];
    const filler = [T + 120, "1.73", "1.73", "1.73", "1.73", "0"];
    const { rest, urls } = fixture([[before, ...recorded, filler]]);
    const page = await rest.candles("pearlusdt", "1m", T * 1000, (T + 2000 * 60) * 1000);
    expect(page.coveredTo).toBe((T + 1000 * 60) * 1000);
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({ period: "1", time_from: String(T), time_to: String(T + 1000 * 60 - 1), limit: "1000" });
    expect(page.klines.map(bar => bar.openTime)).toEqual([T * 1000, (T + 60) * 1000]);
    expect(page.klines[1]).toEqual({ openTime: (T + 60) * 1000, open: "1.78", high: "1.78", low: "1.77", close: "1.78", volume: "3969.9274", quoteVolume: "0", trades: 0, takerBuyVolume: "0", takerBuyQuoteVolume: "0" });
  });
  test("rejects malformed and unordered rows", async () => {
    const { rest } = fixture([[[String(T), "1", "1", "1", "1", "1"]], [recorded[1], recorded[0]]]);
    await expect(rest.candles("pearlusdt", "1m", T * 1000, (T + 120) * 1000)).rejects.toThrow("Invalid SafeTrade candle");
    await expect(rest.candles("pearlusdt", "1m", T * 1000, (T + 120) * 1000)).rejects.toThrow("Unordered");
  });
  test("earliest walks daily windows to the first day, then its first minute", async () => {
    const day = 1779494400; // PEARL's first day, 2026-05-23 (history of the renamed PRL market)
    const clock = day * 1000 + 170 * DAY;
    const empty = Array.from({ length: 20 }, () => []);
    const { rest, urls } = fixture([...empty, [[day, "0.5", "0.7", "0.3", "0.44", "140132.3325"]], [[day + 11040, "0.5", "0.5", "0.5", "0.5", "10"]]], clock);
    expect(await rest.earliest("pearlusdt", "1m")).toBe((day + 11040) * 1000);
    expect(urls.slice(19).map(url => [url.searchParams.get("period"), url.searchParams.get("time_from"), url.searchParams.get("limit")])).toEqual([
      ["1440", String(19_000 * 86400), "1000"], ["1440", String(20_000 * 86400), String(Math.ceil((clock - 20_000 * DAY) / DAY))], ["1", String(day), "1440"],
    ]);
  });
  test("native parity candles stay inside one limit-sized window", async () => {
    const { rest, urls } = fixture([[]]);
    await rest.nativeCandles("pearlusdt", "4h", 0, 10_000 * DAY);
    expect(urls[0]!.searchParams.get("time_to")).toBe(String(1000 * 4 * 3600 - 1));
    await expect(rest.nativeCandles("pearlusdt", "1w", 0, DAY)).rejects.toThrow("Unsupported");
  });
  test("instruments: upper-case units, enabled markets trade", async () => {
    const { rest } = fixture([[
      { id: "pearlusdt", base_unit: "pearl", quote_unit: "usdt", state: "enabled" },
      { id: "prlusdt", base_unit: "prl", quote_unit: "usdt", state: "disabled" },
    ]]);
    expect(await rest.instruments()).toEqual([
      { symbol: "pearlusdt", base: "PEARL", quote: "USDT", status: "TRADING" },
      { symbol: "prlusdt", base: "PRL", quote: "USDT", status: "disabled" },
    ]);
    expect(safetrade.symbol("PEARL", "USDT")).toBe("pearlusdt");
  });
});

describe("SafeTrade stream", () => {
  const wanted = new Set(["pearlusdt"]);
  test("applies a trade batch oldest first", () => {
    const f = sinkFixture();
    parseSafeTradeFrame({ "pearlusdt.trades": [
      { id: 24642181, market: "pearlusdt", price: "1.79", amount: "5.1561", total: "9.229419", side: "buy", created_at: "2026-11-08T10:48:01Z" },
      { id: 24642180, market: "pearlusdt", price: "1.78", amount: "787.618", total: "1401.96004", side: "sell", created_at: "2026-11-08T10:48:00Z" },
    ] }, wanted, f.sink, 0);
    expect(f.trades).toEqual([
      { symbol: "pearlusdt", trade: { time: Date.UTC(2026, 10, 8, 10, 48, 0), price: "1.78", quantity: "787.618", count: 1, takerBuy: null } },
      { symbol: "pearlusdt", trade: { time: Date.UTC(2026, 10, 8, 10, 48, 1), price: "1.79", quantity: "5.1561", count: 1, takerBuy: null } },
    ]);
    expect(f.errors).toEqual([]);
  });
  test("tickers: base volume is `amount`, quote volume is `volume`; other markets are ignored", () => {
    const f = sinkFixture();
    const row = { id: "pearlusdt", avg_price: "1.77", high: "1.84", last: "1.78", low: "1.69", open: "1.6", price_change_percent: "+11.25%", volume: "2347881.77252902", amount: "1326190.2802" };
    parseSafeTradeFrame({ "global.tickers": { pearlusdt: row, btcusdt: { ...row, id: "btcusdt" } } }, wanted, f.sink, 1234);
    expect(f.tickers).toEqual([{ symbol: "pearlusdt", lastPrice: "1.78", openPrice: "1.6", highPrice: "1.84", lowPrice: "1.69", volume: "1326190.2802", quoteVolume: "2347881.77252902", changePercent: 11.25, eventTime: 1234 }]);
  });
  test("acknowledgements pass; unknown streams and malformed trades are reported, never fatal", () => {
    const f = sinkFixture();
    parseSafeTradeFrame({ success: { message: "subscribed", streams: ["pearlusdt.trades"] } }, wanted, f.sink, 0);
    parseSafeTradeFrame({ "btcusdt.trades": [] }, wanted, f.sink, 0);
    parseSafeTradeFrame({ "pearlusdt.trades": [{ id: 1, price: "1", amount: "1", created_at: "yesterday" }] }, wanted, f.sink, 0);
    expect(f.trades).toEqual([]);
    expect(f.errors).toEqual(["Error: Unexpected SafeTrade stream: btcusdt.trades", "Error: Invalid SafeTrade trade"]);
  });
});

test("daily windows advance a full page when a market has no history yet", async () => {
  const { rest } = fixture([[], [], []], 2500 * DAY + 5 * MINUTE);
  expect(await rest.earliest("newusdt", "1m")).toBeNull();
});
