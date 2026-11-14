import { describe, expect, test } from "bun:test";
import type { LiveSink, Trade } from "../src/venues/types";
import type { Ticker } from "../src/live/protocol";
import { createOkxRest, okx, parseOkxFrame } from "../src/venues/okx";
import { DAY, MINUTE } from "../src/candles/kline";

// Recorded history-candles response for OKB-USDT, 2026-10-11 00:00 UTC.
const recorded = [
  ["1791676860000", "126.31", "126.31", "126.31", "126.31", "0.685382", "86.57060042", "86.57060042", "1"],
  ["1791676800000", "126.33", "126.34", "126.29", "126.3", "5.57241", "703.93967276", "703.93967276", "1"],
];
function fixture(respond: (url: URL) => unknown, clock = 1791849600000) {
  let now = clock;
  const requests: URL[] = [];
  const fetcher: typeof fetch = Object.assign(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    return Response.json(respond(url));
  }, { preconnect: fetch.preconnect });
  return { requests, rest: createOkxRest(okx.defaults, { fetcher, now: () => now, sleep: async ms => { now += ms; } }) };
}
const envelope = (data: unknown) => ({ code: "0", msg: "", data });
describe("OKX REST", () => {
  test("parses recorded reverse rows, spot quote volume, and orders ascending", async () => {
    const { rest } = fixture(() => envelope(recorded));
    const page = await rest.candles("OKB-USDT", "1m", 1791676800000, 1791676920000);
    expect(page.coveredTo).toBe(1791676920000);
    expect(page.klines.map(k => k.openTime)).toEqual([1791676800000, 1791676860000]);
    expect(page.klines[0]).toMatchObject({ open: "126.33", close: "126.3", volume: "5.57241", quoteVolume: "703.93967276", trades: 0, takerBuyVolume: "0" });
  });
  test("preserves tiny prices, truncates volumes, and ignores unconfirmed rows", async () => {
    const row = ["60000", "0.000000001234567891", "0.000000001234567891", "0.000000001234567891", "0.000000001234567891", "1.123456789123", "99", "2.987654321234", "1"];
    const { rest } = fixture(() => envelope([row, [...row.slice(0,8), "0"]]));
    const page = await rest.candles("PONS-USDT", "1m", 60000, 120000);
    expect(page.klines).toHaveLength(1);
    expect(page.klines[0]).toMatchObject({ open: "0.000000001234567891", volume: "1.12345678", quoteVolume: "2.98765432" });
  });
  test("empty windows advance by 100 rows and clamp to end", async () => {
    const { rest, requests } = fixture(() => envelope([]));
    expect(await rest.candles("OKB-USDT", "1m", MINUTE, 1000 * MINUTE)).toEqual({ klines: [], coveredTo: 101 * MINUTE });
    expect(requests[0]!.searchParams.get("before")).toBe(String(MINUTE - 1));
    expect((await rest.candles("OKB-USDT", "1m", MINUTE, 2 * MINUTE)).coveredTo).toBe(2 * MINUTE);
  });
  test("rejects API errors inside HTTP 200 and malformed data", async () => {
    const { rest } = fixture(() => ({ code: "51001", msg: "Instrument ID does not exist", data: [] }));
    await expect(rest.candles("BAD-USDT", "1m", 0, MINUTE)).rejects.toThrow("51001");
    const malformed = fixture(() => envelope([["60000", "NaN"]]));
    await expect(malformed.rest.candles("OKB-USDT", "1m", 0, MINUTE)).rejects.toThrow("Invalid OKX candle");
  });
  test("finds first daily then first minute across empty prelisting history", async () => {
    const first = 10 * DAY + 513 * MINUTE;
    const { rest, requests } = fixture(url => {
      const daily = url.searchParams.get("bar") === "1Dutc";
      const ts = daily ? 10 * DAY : first;
      return envelope(ts < Number(url.searchParams.get("after")) ? [[String(ts), "1", "1", "1", "1", "2", "2", "2", "1"]] : []);
    }, 20 * DAY);
    expect(await rest.earliest("OKB-USDT", "1m")).toBe(first);
    expect(requests.length).toBeLessThan(20);
    expect(await rest.earliest("OKB-USDT", "1d")).toBe(10 * DAY);
    expect(await fixture(() => envelope([])).rest.earliest("EMPTY-USDT", "1m")).toBeNull();
  });
  test("maps instruments and UTC native intervals", async () => {
    const { rest, requests } = fixture(url => envelope(url.pathname.endsWith("instruments") ? [{ instId: "OKB-USDT", baseCcy: "OKB", quoteCcy: "USDT", state: "live" }] : []));
    expect(await rest.instruments()).toEqual([{ symbol: "OKB-USDT", base: "OKB", quote: "USDT", status: "TRADING" }]);
    await rest.nativeCandles("OKB-USDT", "1d", DAY, 2 * DAY);
    expect(requests[1]!.searchParams.get("bar")).toBe("1Dutc");
  });
});

describe("OKX live frames", () => {
  function collector() {
    const trades: Trade[] = [], tickers: Ticker[] = [], errors: string[] = [];
    const sink: LiveSink = { trade: (_, value) => trades.push(value), ticker: value => tickers.push(value), connected: () => {}, invalid: value => errors.push(value) };
    return { trades, tickers, errors, sink };
  }
  test("parses taker side and aggregate count in frame order; ignores snapshots", () => {
    const { sink, trades, errors } = collector();
    const message = { arg: { channel: "trades", instId: "OKB-USDT" }, data: [{ instId: "OKB-USDT", tradeId: "123", px: "126.31", sz: "0.123456789", side: "buy", ts: "1791676800000", count: "2" }, { instId: "OKB-USDT", px: "126.30", sz: "1", side: "sell", ts: "1791676800001" }] };
    parseOkxFrame(JSON.stringify({ ...message, action: "snapshot" }), sink);
    expect(trades).toHaveLength(0);
    parseOkxFrame(JSON.stringify(message), sink);
    expect(trades).toEqual([{ time: 1791676800000, price: "126.31", quantity: "0.12345678", count: 2, takerBuy: true }, { time: 1791676800001, price: "126.3", quantity: "1", count: 1, takerBuy: false }]);
    expect(errors).toEqual([]);
  });
  test("parses rolling ticker and reports invalid frames without throwing", () => {
    const { sink, tickers, errors } = collector();
    parseOkxFrame("pong", sink);
    parseOkxFrame(JSON.stringify({ arg: { channel: "tickers", instId: "OKB-USDT" }, data: [{ instId: "OKB-USDT", last: "126.31", open24h: "125", high24h: "130", low24h: "120", vol24h: "1.123456789", volCcy24h: "140.987654321", ts: "1791676800000" }] }), sink);
    expect(tickers[0]).toEqual({ symbol: "OKB-USDT", lastPrice: "126.31", openPrice: "125", highPrice: "130", lowPrice: "120", volume: "1.12345678", quoteVolume: "140.98765432", eventTime: 1791676800000, changePercent: 1.048 });
    parseOkxFrame("not json", sink);
    parseOkxFrame('{"event":"error","code":"60012","msg":"Invalid request"}', sink);
    expect(errors).toHaveLength(2);
  });
});
