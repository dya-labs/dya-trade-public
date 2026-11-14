import { describe, expect, test } from "bun:test";
import type { LiveSink, Trade } from "../src/venues/types";
import type { Ticker } from "../src/live/protocol";
import { createKucoinRest, fetchKucoinToken, handleKucoinFrame, kucoin } from "../src/venues/kucoin";
import { DAY, MINUTE } from "../src/candles/kline";

function fixture(replies: unknown[], nowValue = Date.UTC(2026, 9, 12)) {
  const urls: URL[] = [];
  let clock = nowValue;
  const fetcher: typeof fetch = Object.assign(async (input: string | URL | Request) => {
    urls.push(new URL(input instanceof Request ? input.url : input));
    const next = replies.shift();
    if (next === undefined) throw new Error("Unexpected request");
    return Response.json(next);
  }, { preconnect: fetch.preconnect });
  return { urls, rest: createKucoinRest(kucoin.defaults, { fetcher, now: () => clock, sleep: async ms => { clock += ms; } }) };
}
const recorded = [
  ["1566789720", "10411.5", "10401.9", "10411.5", "10396.3", "29.11357276", "302889.301529914"],
  ["1566789660", "10416", "10411.5", "10422.3", "10411.5", "15.61781842", "162703.708997029"],
  ["1566789600", "10408.6", "10416", "10416", "10405.4", "12.45584973", "129666.51508559"],
];

describe("KuCoin REST", () => {
  test("token POST reserves three shared pacing slots and pauses candles and tokens on Retry-After", async () => {
    let clock = 0, request = 0;
    const calls: { method: string | undefined; at: number }[] = [];
    const replies = [
      Response.json({ code: "200000", data: [] }),
      Response.json({ code: "200000", data: { token: "first" } }),
      Response.json({ code: "200000", data: [] }),
      new Response("", { status: 429, headers: { "Retry-After": "120" } }),
      Response.json({ code: "200000", data: [] }),
      Response.json({ code: "200000", data: { token: "second" } }),
    ];
    const fetcher: typeof fetch = Object.assign(async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push({ method: init?.method, at: clock });
      return replies[request++]!;
    }, { preconnect: fetch.preconnect });
    const rest = createKucoinRest({ ...kucoin.defaults, budget: 60 }, { fetcher, now: () => clock, sleep: async ms => { clock += ms; } });
    await rest.candles("ADI-USDT", "1m", 0, MINUTE);
    expect(await fetchKucoinToken(rest)).toEqual({ token: "first" });
    await rest.candles("ADI-USDT", "1m", 0, MINUTE);
    await expect(fetchKucoinToken(rest)).rejects.toThrow("429");
    await rest.candles("ADI-USDT", "1m", 0, MINUTE);
    await fetchKucoinToken(rest);
    expect(calls.slice(0, 4)).toEqual([
      { method: "GET", at: 0 }, { method: "POST", at: 1000 },
      { method: "GET", at: 4000 }, { method: "POST", at: 5000 },
    ]);
    expect(calls[4]!.at).toBeGreaterThanOrEqual(125000);
    expect(calls[5]!.at).toBeGreaterThanOrEqual(125000);
    expect(calls[5]!.at - calls[4]!.at).toBeGreaterThanOrEqual(1000);
  });
  test("parses recorded newest-first candles, preserving quote volume and OHLC order", async () => {
    const { rest } = fixture([{ code: "200000", data: recorded }]);
    const result = await rest.candles("BTC-USDT", "1m", 1566789600000, 1566789780000);
    expect(result.klines.map(k => k.openTime)).toEqual([1566789600000, 1566789660000, 1566789720000]);
    expect(result.klines[2]).toEqual({ openTime: 1566789720000, open: "10411.5", close: "10401.9", high: "10411.5", low: "10396.3", volume: "29.11357276", quoteVolume: "302889.30152991", trades: 0, takerBuyVolume: "0", takerBuyQuoteVolume: "0" });
    expect(result.coveredTo).toBe(1566789780000);
  });
  test("retains sub-1e-8 prices and truncates long volumes (precision boundary fixture)", async () => {
    const { rest } = fixture([{ code: "200000", data: [["1566789600", "0.000000000012345678", "0.000000000012345679", "0.000000000012345679", "0.000000000012345677", "1.123456789123", "0.123456789123"]] }]);
    const bar = (await rest.candles("TINY-USDT", "1m", 1566789600000, 1566789660000)).klines[0]!;
    expect(bar.open).toBe("0.000000000012345678");
    expect(bar.volume).toBe("1.12345678");
    expect(bar.quoteVolume).toBe("0.12345678");
  });
  test("parses captured BABYDOGE prices and 18-digit quote volume", async () => {
    const { rest } = fixture([{ code: "200000", data: [["1791841320", "0.00000000038", "0.000000000379", "0.00000000038", "0.000000000379", "1031137655923.9419", "391.8319150329638878"]] }]);
    const bar = (await rest.candles("BABYDOGE-USDT", "1m", 1791841320000, 1791841380000)).klines[0]!;
    expect(bar.close).toBe("0.000000000379");
    expect(bar.volume).toBe("1031137655923.9419");
    expect(bar.quoteVolume).toBe("391.83191503");
  });
  test("empty windows advance and cannot exceed 1500 rows", async () => {
    const { rest, urls } = fixture([{ code: "200000", data: [] }]);
    const from = Date.UTC(2020, 0, 1);
    expect(await rest.candles("ADI-USDT", "1m", from, from + 5000 * MINUTE)).toEqual({ klines: [], coveredTo: from + 1500 * MINUTE });
    expect(Number(urls[0]!.searchParams.get("endAt")) - Number(urls[0]!.searchParams.get("startAt"))).toBe(89999);
  });
  test("rejects error envelopes and malformed rows", async () => {
    const { rest } = fixture([{ code: "400100", msg: "Unsupported trading pair." }, { code: "200000", data: [["invalid"]] }]);
    await expect(rest.candles("BAD-USDT", "1m", 0, MINUTE)).rejects.toThrow("400100");
    await expect(rest.candles("BAD-USDT", "1m", 0, MINUTE)).rejects.toThrow("Invalid KuCoin candle");
  });
  test("finds the first minute via bounded daily windows, not binary search over empty trading gaps", async () => {
    const day = Date.UTC(2022, 0, 1);
    const row = (time: number) => [String(time / 1000), "1", "2", "2", "1", "3", "4"];
    const { rest, urls } = fixture([{ code: "200000", data: [] }, { code: "200000", data: [row(day + DAY), row(day)] }, { code: "200000", data: [row(day + 9 * MINUTE), row(day + 7 * MINUTE)] }]);
    expect(await rest.earliest("ADI-USDT", "1m")).toBe(day + 7 * MINUTE);
    expect(urls.map(url => url.searchParams.get("type"))).toEqual(["1day", "1day", "1min"]);
  });
  test("returns null for no history", async () => {
    const { rest } = fixture([{ code: "200000", data: [] }], Date.UTC(2017, 8, 2));
    expect(await rest.earliest("EMPTY-USDT", "1m")).toBeNull();
  });
  test("uses display names while retaining the stable REST symbol", async () => {
    const { rest } = fixture([{ code: "200000", data: [{ symbol: "BCHSV-USDT", name: "BSV-USDT", baseCurrency: "BCHSV", quoteCurrency: "USDT", enableTrading: true }] }]);
    expect(await rest.instruments()).toEqual([{ symbol: "BCHSV-USDT", base: "BSV", quote: "USDT", status: "TRADING" }]);
  });
});

describe("KuCoin frames", () => {
  function capture() {
    const trades: Trade[] = [], tickers: Ticker[] = [], errors: string[] = [];
    const sink: LiveSink = { trade(_symbol, trade) { trades.push(trade); }, ticker(ticker) { tickers.push(ticker); }, invalid(error) { errors.push(error); }, connected() {} };
    return { sink, trades, tickers, errors };
  }
  const match = { topic: "/market/match:ADI-USDT", type: "message", subject: "trade.l3match", data: { price: "8.3662", sequence: "28010179032649728", side: "buy", size: "12.98", symbol: "ADI-USDT", time: "1791844776412000000", type: "match" } };
  test("parses recorded nanosecond match frames in received order", () => {
    const { sink, trades, errors } = capture();
    handleKucoinFrame(match, sink);
    handleKucoinFrame({ ...match, data: { ...match.data, side: "sell", time: "1791844776412999999" } }, sink);
    expect(trades).toEqual([{ time: 1791844776412, price: "8.3662", quantity: "12.98", count: 1, takerBuy: true }, { time: 1791844776412, price: "8.3662", quantity: "12.98", count: 1, takerBuy: false }]);
    expect(errors).toEqual([]);
  });
  test("parses the nested numeric 24h snapshot as ticker, never as trades", () => {
    const { sink, tickers, trades, errors } = capture();
    handleKucoinFrame({ topic: "/market/snapshot:MELANIA-USDT", type: "message", subject: "trade.snapshot", data: { sequence: "431732698", data: { symbol: "MELANIA-USDT", lastTradedPrice: 0.08922, open: 0.09194, high: 0.09333, low: 0.08766, vol: 796244.22, volValue: 71800.5057726, datetime: 1791844765629 } } }, sink);
    expect(tickers).toEqual([{ symbol: "MELANIA-USDT", lastPrice: "0.08922", openPrice: "0.09194", highPrice: "0.09333", lowPrice: "0.08766", volume: "796244.22", quoteVolume: "71800.5057726", eventTime: 1791844765629, changePercent: -2.9585 }]);
    expect(trades).toEqual([]);
    expect(errors).toEqual([]);
  });
  test("ignores snapshots and control frames but reports malformed live data", () => {
    const { sink, trades, errors } = capture();
    handleKucoinFrame({ ...match, type: "snapshot" }, sink);
    handleKucoinFrame({ ...match, data: { ...match.data, type: "snapshot" } }, sink);
    handleKucoinFrame({ type: "pong" }, sink);
    handleKucoinFrame({ ...match, data: { ...match.data, time: "broken" } }, sink);
    handleKucoinFrame({ type: "error", code: 400 }, sink);
    expect(trades).toEqual([]);
    expect(errors).toHaveLength(2);
  });
});
