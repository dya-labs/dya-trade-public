import { describe, expect, test } from "bun:test";
import type { LiveSink, Trade } from "../src/venues/types";
import type { Ticker } from "../src/live/protocol";
import { bybit, createBybitRest, handleBybitFrame } from "../src/venues/bybit";
import { DAY, MINUTE } from "../src/candles/kline";

// Captured from GET /v5/market/kline?category=spot&symbol=MOGUSDT&interval=1&limit=3.
const recorded = [["1791844680000", "0.0000001066", "0.0000001066", "0.0000001066", "0.0000001066", "0", "0"], ["1791844620000", "0.0000001066", "0.0000001066", "0.0000001066", "0.0000001066", "0", "0"]];
function envelope(list: unknown[], symbol = "MOGUSDT") { return { retCode: 0, retMsg: "OK", result: { category: "spot", symbol, list } }; }
function client(responses: unknown[], clock = 1791844800000) {
  const urls: URL[] = [];
  const fetcher = Object.assign(async (input: string | URL | Request) => {
    urls.push(new URL(String(input)));
    if (!responses.length) throw new Error("Unexpected request");
    return Response.json(responses.shift());
  }, { preconnect: fetch.preconnect });
  return { urls, rest: createBybitRest(bybit.defaults, { fetcher, now: () => clock, sleep: async ms => { clock += ms; } }) };
}
function row(time: number) { return [String(time), "1", "2", "1", "2", "3", "4"]; }
function collector() {
  const trades: Trade[] = [], tickers: Ticker[] = [], invalid: string[] = [];
  const sink: LiveSink = { trade: (_symbol, trade) => trades.push(trade), ticker: ticker => tickers.push(ticker), invalid: error => invalid.push(error), connected() {} };
  return { trades, tickers, invalid, sink };
}

describe("Bybit REST", () => {
  test("sorts recorded newest-first candles and bounds inclusive end", async () => {
    const { rest, urls } = client([envelope(recorded)]);
    const page = await rest.candles("MOGUSDT", "1m", 1791844620000, 1791844740000);
    expect(page.klines.map(bar => bar.openTime)).toEqual([1791844620000, 1791844680000]);
    expect(page.klines[0]!.open).toBe("0.0000001066");
    expect(page.coveredTo).toBe(1791844740000);
    expect(urls[0]!.searchParams.get("end")).toBe("1791844739999");
  });
  test("preserves sub-1e-8 prices and truncates high-precision volumes", async () => {
    // Precision boundary variant of the recorded seven-string row shape.
    const { rest } = client([envelope([["60000", "0.000000001234", "0.000000001235", "0.000000001233", "0.000000001234", "12.123456789123", "0.123456789123"]])]);
    const bar = (await rest.candles("MOGUSDT", "1m", MINUTE, 2 * MINUTE)).klines[0]!;
    expect(bar.open).toBe("0.000000001234");
    expect(bar.volume).toBe("12.12345678");
    expect(bar.quoteVolume).toBe("0.12345678");
    expect([bar.trades, bar.takerBuyVolume, bar.takerBuyQuoteVolume]).toEqual([0, "0", "0"]);
  });
  test("advances empty windows by exactly 1000 resolutions", async () => {
    const { rest } = client([envelope([])]);
    expect(await rest.candles("MOGUSDT", "1m", 0, 2000 * MINUTE)).toEqual({ klines: [], coveredTo: 1000 * MINUTE });
  });
  test("rejects HTTP-200 venue errors and malformed rows", async () => {
    const { rest } = client([{ retCode: 10001, retMsg: "params error!" }, envelope([["bad"]])]);
    await expect(rest.candles("MOGUSDT", "1m", 0, MINUTE)).rejects.toThrow("10001");
    await expect(rest.candles("MOGUSDT", "1m", 0, MINUTE)).rejects.toThrow("Invalid Bybit candle");
  });
  test("rejects duplicate candle times", async () => {
    const { rest } = client([envelope([row(MINUTE), row(MINUTE)])]);
    await expect(rest.candles("MOGUSDT", "1m", MINUTE, MINUTE * 2)).rejects.toThrow("Duplicate");
  });
  test("finds first minute within first daily candle across empty first window", async () => {
    const first = 10 * DAY, listed = first + 1100 * MINUTE;
    const { rest, urls } = client([envelope([row(first + DAY), row(first)]), envelope([]), envelope([row(listed)])]);
    expect(await rest.earliest("MOGUSDT", "1m")).toBe(listed);
    expect(urls[0]!.searchParams.get("interval")).toBe("D");
    expect(urls[1]!.searchParams.get("start")).toBe(String(first));
    expect(urls[2]!.searchParams.get("start")).toBe(String(first + 1000 * MINUTE));
  });
  test("walks full daily pages backwards before locating the listing", async () => {
    const daily = Array.from({ length: 1000 }, (_, i) => row((1000 - i) * DAY));
    const { rest, urls } = client([envelope(daily), envelope([row(0)])]);
    expect(await rest.earliest("MOGUSDT", "1d")).toBe(0);
    expect(urls[1]!.searchParams.get("end")).toBe(String(DAY - 1));
  });
  test("returns null for empty history", async () => {
    const { rest } = client([envelope([]), envelope([])]);
    expect(await rest.earliest("MOGUSDT", "1m")).toBeNull();
  });
  test("paginates instruments and maps trading status", async () => {
    const instrument = { symbol: "MOGUSDT", baseCoin: "MOG", quoteCoin: "USDT", status: "Trading" };
    const { rest, urls } = client([{ retCode: 0, result: { list: [instrument], nextPageCursor: "next" } }, { retCode: 0, result: { list: [{ ...instrument, symbol: "MONUSDT", baseCoin: "MON", status: "Closed" }], nextPageCursor: "" } }]);
    expect((await rest.instruments()).map(item => item.status)).toEqual(["TRADING", "Closed"]);
    expect(urls[1]!.searchParams.get("cursor")).toBe("next");
  });
});

describe("Bybit frames", () => {
  // Bybit's documented real-time trade payload uses type=snapshot, not delta.
  const frame = { topic: "publicTrade.BTCUSDT", type: "snapshot", ts: 1672304486868, data: [{ T: 1672304486865, s: "BTCUSDT", S: "Buy", v: "0.001", p: "16578.50", i: "20f43950-d8dd-5b31-9112-a178eb6023af", BT: false }] };
  test("accepts live snapshot trades in venue order with taker side", () => {
    const c = collector();
    handleBybitFrame({ ...frame, data: [...frame.data, { ...frame.data[0], S: "Sell", T: 1672304486866 }] }, new Set(["BTCUSDT"]), c.sink);
    expect(c.trades.map(t => [t.time, t.takerBuy])).toEqual([[1672304486865, true], [1672304486866, false]]);
    expect(c.trades[0]).toMatchObject({ price: "16578.5", quantity: "0.001", count: 1 });
    expect(c.invalid).toEqual([]);
  });
  test("ignores history frames and snapshots from unrelated channels/symbols", () => {
    const c = collector(), symbols = new Set(["BTCUSDT"]);
    handleBybitFrame({ ...frame, type: "history" }, symbols, c.sink);
    handleBybitFrame({ ...frame, topic: "orderbook.BTCUSDT" }, symbols, c.sink);
    handleBybitFrame(frame, new Set(["MOGUSDT"]), c.sink);
    expect(c.trades).toEqual([]);
    expect(c.invalid).toEqual([]);
  });
  test("parses full spot ticker snapshots and rounds rolling percent", () => {
    const c = collector();
    handleBybitFrame({ topic: "tickers.MOGUSDT", type: "snapshot", ts: 1791844723156, data: { symbol: "MOGUSDT", lastPrice: "0.0000001066", prevPrice24h: "0.0000001", highPrice24h: "0.00000012", lowPrice24h: "0.00000009", volume24h: "123.123456789", turnover24h: "0.123456789" } }, new Set(["MOGUSDT"]), c.sink);
    expect(c.tickers[0]).toMatchObject({ lastPrice: "0.0000001066", openPrice: "0.0000001", changePercent: 6.6, volume: "123.12345678", quoteVolume: "0.12345678", eventTime: 1791844723156 });
  });
  test("reports malformed trades and failed subscriptions without throwing", () => {
    const c = collector(), symbols = new Set(["BTCUSDT"]);
    handleBybitFrame({ ...frame, data: [{ ...frame.data[0], S: "Unknown" }] }, symbols, c.sink);
    handleBybitFrame({ success: false, ret_msg: "bad topic" }, symbols, c.sink);
    expect(c.invalid).toHaveLength(2);
    expect(c.trades).toEqual([]);
  });
});

test("parses the recorded MOG spot ticker snapshot", () => {
  const c = collector();
  handleBybitFrame({
    topic: "tickers.MOGUSDT", type: "snapshot", ts: 1791844815161,
    data: { symbol: "MOGUSDT", lastPrice: "0.0000001066", prevPrice24h: "0.0000001114", highPrice24h: "0.0000001134", lowPrice24h: "0.0000001061", volume24h: "506184703857", turnover24h: "55804.72969858" },
  }, new Set(["MOGUSDT"]), c.sink);
  expect(c.tickers[0]).toMatchObject({ changePercent: -4.3088, volume: "506184703857", quoteVolume: "55804.72969858" });
  expect(c.invalid).toEqual([]);
});
