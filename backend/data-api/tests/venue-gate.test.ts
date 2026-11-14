import { describe, expect, test } from "bun:test";
import type { LiveSink, Trade } from "../src/venues/types";
import type { Ticker } from "../src/live/protocol";
import { DAY, MINUTE } from "../src/candles/kline";
import { createGateRest, gate, parseGateFrame } from "../src/venues/gate";

// Recorded Gate v4 RHEA_USDT candle, with decimal edge cases tested separately.
const recorded = ["1791844560", "0.0", "0.07741", "0.07741", "0.07741", "0.07741", "0.0", "true"];
function fixture(responses: unknown[], clock = 1791844800000) {
  const urls: string[] = [];
  let time = clock;
  const fetcher = (async (input: string | URL | Request) => {
    urls.push(String(input));
    if (!responses.length) throw new Error("Unexpected Gate request");
    return Response.json(responses.shift());
  }) as typeof fetch;
  return { urls, rest: createGateRest(gate.defaults, { fetcher, now: () => time, sleep: async ms => { time += ms; } }) };
}
function sinkFixture() {
  const trades: { symbol: string; trade: Trade }[] = [], tickers: Ticker[] = [], errors: string[] = [];
  const sink: LiveSink = { trade: (symbol, trade) => trades.push({ symbol, trade }), ticker: ticker => tickers.push(ticker), invalid: error => errors.push(error), connected() {} };
  return { sink, trades, tickers, errors };
}
describe("Gate candles", () => {
  test("parses recorded rows, sorts and excludes current candles", async () => {
    const t = Number(recorded[0]) * 1000;
    const later = [...recorded]; later[0] = String(t / 1000 + 60);
    const current = [...recorded]; current[0] = String(t / 1000 + 120); current[7] = "false";
    const { rest } = fixture([[later, current, recorded]]);
    const page = await rest.candles("RHEA_USDT", "1m", t, t + 3 * MINUTE);
    expect(page.klines.map(row => row.openTime)).toEqual([t, t + MINUTE]);
    expect(page.klines[0]).toMatchObject({ open: "0.07741", volume: "0", quoteVolume: "0", trades: 0 });
    expect(page.coveredTo).toBe(t + 3 * MINUTE);
  });
  test("preserves sub-satoshi prices and truncates base and quote volumes", async () => {
    const edge = ["1791844560", "23.123456789012", "0.000000001234", "0.000000001235", "0.000000001233", "0.000000001234", "12.123456789012", "true"];
    const { rest } = fixture([[edge]]);
    const { klines } = await rest.candles("TINY_USDT", "1m", 1791844560000, 1791844620000);
    expect(klines[0]).toMatchObject({ open: "0.000000001234", volume: "12.12345678", quoteVolume: "23.12345678" });
  });
  test("empty windows advance by at most 1000 points, exclusive end", async () => {
    const { rest, urls } = fixture([[]], 0);
    expect(await rest.candles("RHEA_USDT", "1m", 0, 2000 * MINUTE)).toEqual({ klines: [], coveredTo: 1000 * MINUTE });
    expect(new URL(urls[0]!).searchParams.get("to")).toBe("59999");
  });
  test("rejects HTTP-200 error envelopes and duplicate rows", async () => {
    const { rest } = fixture([{ label: "INVALID_PARAM_VALUE", message: "Candlestick too long ago" }, [recorded, recorded]], 0);
    await expect(rest.candles("RHEA_USDT", "1m", 0, MINUTE)).rejects.toThrow("INVALID_PARAM_VALUE");
    await expect(rest.candles("RHEA_USDT", "1m", 1791844560000, 1791844620000)).rejects.toThrow("Duplicate");
  });
  test("covers expired prefixes without requesting unrecoverable candles", async () => {
    const clock = 15000 * MINUTE;
    const bound = (15000 - 9990) * MINUTE;
    const { rest, urls } = fixture([], clock);
    expect(await rest.candles("RHEA_USDT", "1m", 0, bound + MINUTE)).toEqual({ klines: [], coveredTo: bound });
    expect(await rest.candles("RHEA_USDT", "1m", 0, MINUTE)).toEqual({ klines: [], coveredTo: MINUTE });
    expect(urls).toHaveLength(0);
  });
  test("finds first daily candle and uses safety-margined retention", async () => {
    const clock = 15000 * MINUTE;
    const first = ["0", "1", "2", "2", "2", "2", "1", "true"];
    const minuteStart = (15000 - 9990) * MINUTE;
    const retained = [...first]; retained[0] = String(minuteStart / 1000);
    const { rest } = fixture([[first], [retained]], clock);
    expect(await rest.earliest("RHEA_USDT", "1d")).toBe(0);
    expect(await rest.earliest("RHEA_USDT", "1m")).toBe(minuteStart);
  });
  test("walks empty daily windows to listing and honors later listing", async () => {
    const start = 1000 * DAY;
    const daily = [String(start / 1000), "1", "2", "2", "2", "2", "1", "true"];
    const { rest } = fixture([[], [daily], [daily]], start + DAY);
    expect(await rest.earliest("NEW_USDT", "1h")).toBe(start);
  });
  test("returns null for pairs without candles", async () => {
    const { rest } = fixture([[], []], DAY);
    expect(await rest.earliest("NEW_USDT", "1d")).toBeNull();
  });
  test("retries empty discovery and caches the first successful listing", async () => {
    const first = ["0", "1", "2", "2", "2", "2", "1", "true"];
    const { rest, urls } = fixture([[], [], [first]], DAY);
    expect(await rest.earliest("NEW_USDT", "1d")).toBeNull();
    expect(await rest.earliest("NEW_USDT", "1d")).toBe(0);
    expect(await rest.earliest("NEW_USDT", "1d")).toBe(0);
    expect(urls).toHaveLength(3);
  });
});
describe("Gate live frames", () => {
  test("parses fractional millisecond trade timestamp and taker side", () => {
    const f = sinkFixture();
    const frame = { channel: "spot.trades", event: "update", result: { id: 123, create_time_ms: "1791844560123.456", side: "buy", amount: "12.123456789", price: "0.000000001234", currency_pair: "RHEA_USDT" } };
    parseGateFrame(frame, f.sink);
    expect(f.trades).toEqual([{ symbol: "RHEA_USDT", trade: { time: 1791844560123, price: "0.000000001234", quantity: "12.12345678", count: 1, takerBuy: true } }]);
    parseGateFrame({ ...frame, event: "snapshot" }, f.sink);
    parseGateFrame({ ...frame, event: "subscribe" }, f.sink);
    expect(f.trades).toHaveLength(1);
    expect(f.errors).toHaveLength(0);
  });
  test("derives rolling open without losing tiny prices and prefers exact open", () => {
    const f = sinkFixture();
    const result = { currency_pair: "RHEA_USDT", last: "0.0000000011", change_percentage: "10", high_24h: "0.0000000012", low_24h: "0.0000000009", base_volume: "123.123456789", quote_volume: "0.123456789" };
    const frame = { channel: "spot.tickers", event: "update", time: 1791844560, result };
    parseGateFrame(frame, f.sink);
    expect(f.tickers[0]).toMatchObject({ openPrice: "0.000000001", changePercent: 10, volume: "123.12345678", quoteVolume: "0.12345678", eventTime: 1791844560000 });
    parseGateFrame({ ...frame, result: { ...result, open: "0.0000000011" } }, f.sink);
    expect(f.tickers[1]?.changePercent).toBe(0);
    expect(f.errors).toHaveLength(0);
  });
  test("reports malformed frames without throwing", () => {
    const f = sinkFixture();
    parseGateFrame({ channel: "spot.trades", event: "update", result: {} }, f.sink);
    parseGateFrame({ error: { code: 2, message: "invalid argument" } }, f.sink);
    expect(f.errors).toHaveLength(2);
  });
});
