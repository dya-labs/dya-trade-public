import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { BarReader, Tail } from "../src/api/bars";
import { LiveBars } from "../src/api/live";
import type { Kline } from "../src/candles/kline";
import type { WireBar } from "../src/candles/bar";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-12T10:00:00Z");
const BTC = { id: "binance:BTCUSDT", venue: "binance", symbol: "BTCUSDT" };
const minute = (openTime: number, close: string, volume: string): Kline => ({
  openTime, open: close, high: close, low: close, close, volume, quoteVolume: volume, trades: 1, takerBuyVolume: "0", takerBuyQuoteVolume: "0",
});

function setup(tail: (start: number) => Promise<Tail>) {
  const emitted: WireBar[] = [];
  const reader = { tail: (_market: unknown, _interval: string, _anchor: number, start: number) => tail(start) } as unknown as BarReader;
  return { live: new LiveBars(reader, (_market, _interval, bar) => emitted.push(bar)), emitted };
}

afterEach(() => { setSystemTime(); });

describe("live bar folding", () => {
  test("continues the stored prefix, converges repeated minute updates, and rolls into the next bucket", async () => {
    setSystemTime(new Date(T0 + 30 * 60_000));
    const seed = minute(T0, "10", "5");
    const { live, emitted } = setup(async start => ({ start, seed, cutoff: T0 + 29 * 60_000, minutes: [minute(T0 + 29 * 60_000, "10.5", "1")] }));
    const initial = await live.open(BTC, "1h", 0);
    expect(initial?.slice(0, 6)).toEqual([T0, "10", "10.5", "10", "10.5", "6"]);
    expect(emitted).toEqual([]);

    const update = (kline: Kline) => live.onKline("binance", { symbol: "BTCUSDT", closed: false, kline });
    update(minute(T0 + 30 * 60_000, "11", "1"));
    update(minute(T0 + 30 * 60_000, "9", "2"));
    // Minutes before the cutoff are already inside the seed and must not be counted twice.
    update(minute(T0 + 10 * 60_000, "99", "50"));
    // The same symbol on another venue is a different market.
    live.onKline("okx", { symbol: "BTCUSDT", closed: false, kline: minute(T0 + 31 * 60_000, "1", "1") });
    expect(emitted.at(-1)?.slice(0, 6)).toEqual([T0, "10", "10.5", "9", "9", "8"]);
    expect(emitted).toHaveLength(2);

    update(minute(T0 + HOUR, "12", "0.5"));
    expect(emitted.at(-1)?.slice(0, 6)).toEqual([T0 + HOUR, "12", "12", "12", "12", "0.5"]);
    update(minute(T0 + 59 * 60_000, "1", "1"));
    expect(emitted).toHaveLength(4);
    expect(emitted[2]?.[0]).toBe(T0); // Final closed bar precedes the next bucket.
  });

  test("stream updates during the initial seed are replayed onto it, not published unseeded", async () => {
    setSystemTime(new Date(T0 + 5 * 60_000));
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { live, emitted } = setup(async start => {
      await gate;
      return { start, seed: minute(T0, "10", "5"), cutoff: T0 + 5 * 60_000, minutes: [] };
    });
    const opening = live.open(BTC, "1h", 0);
    live.onKline("binance", { symbol: "BTCUSDT", closed: false, kline: minute(T0 + 5 * 60_000, "10.2", "1") });
    expect(emitted).toEqual([]);
    release();
    expect((await opening)?.slice(0, 6)).toEqual([T0, "10", "10.2", "10", "10.2", "6"]);
  });

  test("a REST-settled closed bucket emits exactly one corrected closed bar", async () => {
    setSystemTime(new Date(T0 + 30_000));
    const emitted: { bar: WireBar; closed: boolean }[] = [];
    const original = minute(T0, "10", "1");
    const corrected = minute(T0, "11", "2");
    const reader = {
      tail: async (_market: unknown, _interval: string, _anchor: number, start: number) => ({ start, seed: undefined, cutoff: start, minutes: start === T0 ? [original] : [] }),
      read: async () => ({ bars: [corrected], final: true }),
    } as unknown as BarReader;
    const live = new LiveBars(reader, (_market, _interval, bar, closed = false) => emitted.push({ bar, closed }));
    await live.open(BTC, "1m", 0);
    live.onKline("binance", { symbol: "BTCUSDT", closed: true, kline: original });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.closed).toBe(true);
    setSystemTime(new Date(T0 + 70_000));
    await live.reseedStale();
    setSystemTime(new Date(T0 + 80_000));
    await live.reseedStale();
    expect(emitted).toHaveLength(2);
    expect(emitted[1]?.closed).toBe(true);
    expect(emitted[1]?.bar.slice(0, 6)).toEqual([T0, "11", "11", "11", "11", "2"]);
  });
});
