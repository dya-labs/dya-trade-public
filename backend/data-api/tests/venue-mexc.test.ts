import { describe, expect, test } from "bun:test";
import { DAY, HOUR, MINUTE } from "../src/candles/kline";
import { createMexcRest, mexc, parseMexcDeals, parseMexcTicker } from "../src/venues/mexc";

const now = 1791844800000;
const row = [1791814740000, "0.92366", "0.92458", "0.92278", "0.92365", "186.75", 1791814800000, "172.5005"];
// Captured COCAUSDT public protobuf frame, 2026-10-12. Unknown field 6 on deals is deliberately preserved.
const frame = "0a3073706f74407075626c69632e61676772652e6465616c732e76332e6170692e7062403130306d7340434f4341555344541a08434f43415553445430cbce9a929334d213c1010a4a0a07302e3839383432120531372e3637180120b8ce9a9293342a2937333834363031343136313439393735303458315f3733383436303131393632343236313633325831309bf1e187020a4a0a07302e3839393035120532352e3635180120b8ce9a9293342a2937333834363031343136313439393735303458325f3733383436303133343834353433313830385831309cf1e18702122773706f74407075626c69632e61676772652e6465616c732e76332e6170692e7062403130306d73";
function fixture(respond: (url: URL) => unknown) {
  let clock = now;
  const fetcher: typeof fetch = Object.assign(async (input: string | URL | Request) => new Response(JSON.stringify(respond(new URL(input instanceof Request ? input.url : input)))), { preconnect: fetch.preconnect });
  return createMexcRest(mexc.defaults, { fetcher, now: () => clock, sleep: async ms => { clock += ms; } });
}

describe("MEXC", () => {
  test("parses recorded candles, preserves tiny prices, truncates volume and orders uniquely", async () => {
    const tiny = [1791814800000, "0.000000000123", "0.000000000124", "0.000000000122", "0.000000000123", "12.123456789123", 1791814860000, "0.123456789123"];
    const rest = fixture(() => [tiny, row, row]);
    const page = await rest.candles("COCAUSDT", "1m", 1791814740000, 1791814860000);
    expect(page.coveredTo).toBe(1791814860000);
    expect(page.klines.map(bar => bar.openTime)).toEqual([1791814740000, 1791814800000]);
    expect(page.klines[1]).toMatchObject({ open: "0.000000000123", volume: "12.12345678", quoteVolume: "0.12345678", trades: 0, takerBuyVolume: "0" });
  });
  test("empty windows advance and newest fallback rows never leak", async () => {
    const rest = fixture(() => [row]);
    expect(await rest.candles("COCAUSDT", "1m", now - DAY, now)).toEqual({ klines: [], coveredTo: now - DAY + 500 * MINUTE });
    expect(await fixture(() => []).candles("COCAUSDT", "1h", now - DAY, now)).toEqual({ klines: [], coveredTo: now });
  });
  test("expired ranges jump to the rolling bound without requesting newest fallback", async () => {
    const rest = fixture(() => { throw new Error("must not fetch expired range"); });
    const bound = now - 30 * DAY + 5 * MINUTE;
    expect(await rest.candles("COCAUSDT", "1m", now - 60 * DAY, now)).toEqual({ klines: [], coveredTo: bound });
    expect(await rest.candles("COCAUSDT", "1m", now - 60 * DAY, now - 40 * DAY)).toEqual({ klines: [], coveredTo: now - 40 * DAY });
  });
  test("native candles paginate to 1000 rows and cap longer requests", async () => {
    const from = now - DAY;
    const starts: number[] = [];
    const rest = fixture(url => {
      const start = Number(url.searchParams.get("startTime"));
      const end = Number(url.searchParams.get("endTime"));
      starts.push(start);
      return Array.from({ length: Math.floor((end + 1 - start) / MINUTE) }, (_, index) => [start + index * MINUTE, ...row.slice(1)]);
    });
    const bars = await rest.nativeCandles("COCAUSDT", "1m", from, from + 1200 * MINUTE);
    expect(starts).toEqual([from, from + 500 * MINUTE]);
    expect(bars).toHaveLength(1000);
    expect(bars[0]!.openTime).toBe(from);
    expect(bars.at(-1)!.openTime).toBe(from + 999 * MINUTE);
  });
  test("native candles skip expired prefixes and continue across empty pages", async () => {
    const bound = now - 30 * DAY + 5 * MINUTE;
    const starts: number[] = [];
    const rest = fixture(url => {
      const start = Number(url.searchParams.get("startTime"));
      starts.push(start);
      return start === bound ? [] : [[start, ...row.slice(1)]];
    });
    const bars = await rest.nativeCandles("COCAUSDT", "1m", now - 60 * DAY, bound + 501 * MINUTE);
    expect(starts).toEqual([bound, bound + 500 * MINUTE]);
    expect(bars.map(bar => bar.openTime)).toEqual([bound + 500 * MINUTE]);
  });
  test("rejects HTTP-200 venue errors and malformed rows", async () => {
    await expect(fixture(() => ({ code: -1121, msg: "Invalid symbol." })).candles("BAD", "1m", now - HOUR, now)).rejects.toThrow("-1121");
    await expect(fixture(() => [[now - MINUTE]]).candles("COCAUSDT", "1m", now - HOUR, now)).rejects.toThrow("row");
  });
  test("minute earliest returns the safe retention boundary or a later listing", async () => {
    const bound = now - 30 * DAY + 5 * MINUTE;
    const rest = fixture(url => [[Number(url.searchParams.get("startTime")) + 2 * MINUTE, ...row.slice(1)]]);
    expect(await rest.earliest("COCAUSDT", "1m")).toBe(bound + 2 * MINUTE);
  });
  test("daily/hourly earliest searches historical windows then listing day", async () => {
    const listing = Math.floor((now - 600 * DAY) / DAY) * DAY;
    const rest = fixture(url => {
      const start = Number(url.searchParams.get("startTime")), end = Number(url.searchParams.get("endTime"));
      if (url.searchParams.get("interval") === "60m") return [[listing + 9 * HOUR, ...row.slice(1)]];
      const first = Math.max(start, listing);
      return first <= end ? [[first, ...row.slice(1)]] : [];
    });
    expect(await rest.earliest("COCAUSDT", "1d")).toBe(listing);
    expect(await rest.earliest("COCAUSDT", "1h")).toBe(listing + 9 * HOUR);
  });
  test("hourly archive can begin after the first daily bar", async () => {
    const listing = Math.floor((now - 100 * DAY) / DAY) * DAY;
    const firstHour = listing + 700 * HOUR;
    const rest = fixture(url => {
      const start = Number(url.searchParams.get("startTime")), end = Number(url.searchParams.get("endTime"));
      if (url.searchParams.get("interval") === "60m") return firstHour >= start && firstHour <= end ? [[firstHour, ...row.slice(1)]] : [];
      return listing >= start && listing <= end ? [[listing, ...row.slice(1)]] : [];
    });
    expect(await rest.earliest("BTCUSDT", "1h")).toBe(firstHour);
  });
  test("daily discovery stops at the historical UTC+8 transition", async () => {
    const end = Math.floor(now / DAY) * DAY;
    const firstUtc = end - 100 * DAY;
    const rest = fixture(() => [[firstUtc - 8 * HOUR, ...row.slice(1)], [firstUtc, ...row.slice(1)]]);
    expect(await rest.earliest("BTCUSDT", "1d")).toBe(firstUtc);
  });
  test("retains suspended spot instruments and validates exchange errors", async () => {
    const rest = fixture(() => ({ symbols: [
      { symbol: "COCAUSDT", baseAsset: "COCA", quoteAsset: "USDT", status: "1", isSpotTradingAllowed: true },
      { symbol: "OLDUSDT", baseAsset: "OLD", quoteAsset: "USDT", status: "2", isSpotTradingAllowed: false },
    ] }));
    expect((await rest.instruments()).map(item => item.status)).toEqual(["TRADING", "2"]);
    await expect(fixture(() => ({ code: -1, msg: "failure" })).instruments()).rejects.toThrow("failure");
  });
  test("decodes real binary trades in venue order", () => {
    const result = parseMexcDeals(Buffer.from(frame, "hex"));
    expect(result.symbol).toBe("COCAUSDT");
    expect(result.trades).toEqual([
      { time: 1791844853560, price: "0.89842", quantity: "17.67", count: 1, takerBuy: true },
      { time: 1791844853560, price: "0.89905", quantity: "25.65", count: 1, takerBuy: true },
    ]);
  });
  test("ignores non-live event types and rejects truncated protobuf", () => {
    const bytes = Buffer.from(frame, "hex");
    const event = Buffer.from("spot@public.aggre.deals.v3.api.pb@100ms");
    const offset = bytes.lastIndexOf(event);
    bytes[offset] = 120;
    expect(parseMexcDeals(bytes).trades).toEqual([]);
    expect(() => parseMexcDeals(Buffer.from(frame.slice(0, -2), "hex"))).toThrow("Truncated");
    expect(() => parseMexcDeals(Uint8Array.of(10, 255))).toThrow("Truncated");
  });
  test("uses rolling ticker open, not the venue fractional change field", () => {
    const ticker = parseMexcTicker({ symbol: "COCAUSDT", priceChangePercent: "-0.0465", lastPrice: "0.89729", openPrice: "0.94108", highPrice: "0.97782", lowPrice: "0.86991", volume: "299056.21", quoteVolume: "278039.09356", closeTime: 1791844784719 });
    expect(ticker.changePercent).toBe(-4.6532);
    expect(ticker.eventTime).toBe(1791844784719);
    expect(() => parseMexcTicker({ code: 700002, msg: "error" })).toThrow("700002");
  });
});
