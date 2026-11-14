import { afterEach, describe, expect, it, vi } from "vitest";
import { isDataUnavailableError, type OHLCV } from "@luxalgo/vela";
import { DataApi } from "@/lib/market-data/api";
import { createBarSource, intervalFor, priceScaleFor } from "@/lib/market-data/chart-feed";
import { createReferenceProvider } from "@/lib/market-data/reference-provider";
import { PRICE_DECIMALS } from "@/lib/market-data/price-decimals";
import seed from "../../../backend/data-api/registry/seed.json";
import { PAGE_SIZE, pageIndex } from "@/lib/market-data/pages";
import type { StreamBar, StreamListener, StreamSubscription } from "@/lib/market-data/stream";

const HOUR = 3_600_000;
const firstOpenTime = Date.UTC(2024, 2, 13, 0);
const now = Date.UTC(2024, 5, 30, 12);
const row = (time: number) => [time, "1", "2", "0.5", "1.5", "10", "15", 4, "5", "7"];
const hours = Array.from({ length: (now - firstOpenTime) / HOUR + 1 }, (_, index) => firstOpenTime + index * HOUR);
const reference = { id: "binance:NEARUSDC", base: "NEAR", quote: "USDC", firstOpenTime };
afterEach(() => { vi.useRealTimers(); });

describe("chart price precision", () => {
  it("uses the venue's price step for exchange markets whatever the price", () => {
    // BTC trades in 0.01 steps: four decimals would always end in "00".
    expect(priceScaleFor({ id: "binance:BTCUSDC", venue: "binance" }, 80_000)).toBe(100);
    expect(priceScaleFor({ id: "binance:PEPEUSDC", venue: "binance" }, 0.0000038)).toBe(1e8);
    expect(priceScaleFor({ id: "mexc:COCAUSDT", venue: "mexc" }, 0.97)).toBe(1e4);
  });

  it("shows Rhea's step-less prices at five significant digits", () => {
    expect(priceScaleFor({ id: "rhea:NPRO_WNEAR", venue: "rhea" }, 0.3307)).toBe(1e5);
    expect(priceScaleFor({ id: "rhea:X_WNEAR", venue: "rhea" }, 12.5)).toBe(1e3);
    expect(priceScaleFor({ id: "rhea:BLACKDRAGON_WNEAR", venue: "rhea" }, 1.0813e-8)).toBe(1e12);
  });

  it("falls back to four significant digits and at least four decimals for unrecorded markets", () => {
    expect(priceScaleFor({ id: "binance:NEWUSDC", venue: "binance" }, 80_000)).toBe(1e4);
    expect(priceScaleFor({ id: "binance:NEWUSDC", venue: "binance" }, 0.0123)).toBe(1e5);
    expect(priceScaleFor({ id: "binance:NEWUSDC", venue: "binance" }, undefined)).toBe(1e4);
  });

  it("records a price step for every current exchange source in the registry", () => {
    const exchangeSources = seed.assets.flatMap(asset => asset.sources).filter(source => source.validTo === null && source.venue !== "rhea" && source.venue !== "intents").map(source => source.id);
    expect(exchangeSources.filter(id => PRICE_DECIMALS[id] === undefined)).toEqual([]);
  });
});

it.each([["1", "1m"], ["15", "15m"], ["60", "1h"], ["4H", "4h"], ["240", "4h"], ["D", "1d"], ["1D", "1d"], ["1440", "1d"], ["3D", "3d"], ["4320", "3d"], ["W", "1w"], ["1W", "1w"], ["10080", "1w"], ["M", "1M"], ["1M", "1M"], ["43200", "1M"], ["45", undefined], ["", undefined], ["2W", undefined], ["1S", undefined]])("reads the Vela timeframe %s as the data API interval %s", (timeframe, interval) => {
  expect(intervalFor(timeframe)).toBe(interval);
});

/** An in-memory data API for one hourly market, paged exactly like the server; the last hour is the open bar. */
function fakeApi(times: number[]) {
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input);
    const latest = url.pathname === "/v1/candles/latest";
    const page = latest ? pageIndex("1h", times.at(-1)!, firstOpenTime) : Number(url.searchParams.get("page"));
    const bars = times.filter(time => Math.floor(time / HOUR / PAGE_SIZE) === page).map(row);
    const first = pageIndex("1h", firstOpenTime, firstOpenTime);
    return Response.json({ market: url.searchParams.get("market"), interval: "1h", revision: "1", page, prev: page === first ? null : page - 1, final: !latest, bars });
  });
  return { fetcher, api: new DataApi("https://data.test", fetcher) };
}

function fakeStream() {
  const listeners = new Map<string, StreamListener>();
  return {
    listeners,
    subscribe: vi.fn((subscription: StreamSubscription, listener: StreamListener) => {
      const key = JSON.stringify(subscription);
      listeners.set(key, listener);
      return () => listeners.delete(key);
    }),
  };
}
function setup(options: { times?: number[] } = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const times = options.times ?? [...hours];
  const { api, fetcher } = fakeApi(times);
  const stream = fakeStream();
  const onStale = vi.fn();
  const source = createBarSource({ api, stream, revision: "1", onStale });
  const provider = createReferenceProvider({ source, market: reference, ticker: "NEAR/USD", intervals: ["1h", "1d"], mintick: 0.0001 });
  return { source, provider, fetcher, stream, times, onStale };
}
const bar = (t: number, close = "1.5"): StreamBar => ({ t, o: "1", h: "2", l: "0.5", c: close, v: "10", x: false });
const latestResponse = (close: string, revision = "1") => {
  const values = row(now); values[4] = close;
  return Response.json({ market: "binance:NEARUSDC", interval: "1h", revision, page: pageIndex("1h", now, firstOpenTime), prev: null, final: false, bars: [values] });
};
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const live = (provider: ReturnType<typeof setup>["provider"], stream: ReturnType<typeof fakeStream>) => {
  const onBar = vi.fn<(bar: OHLCV) => void>();
  const stop = provider.subscribe!("NEAR/USD", "60", onBar);
  return { onBar, stop, listener: stream.listeners.get(JSON.stringify({ type: "candle", market: "binance:NEARUSDC", interval: "1h" }))! };
};

describe("data API chart provider", () => {
  it("loads the latest bars, then scrolls back page by page to the market's first trade", async () => {
    const { provider } = setup();
    const loaded = await provider.getBars("NEAR/USD", "60", { limit: 300 });
    expect(loaded).toHaveLength(300);
    expect(loaded.at(-1)!.time).toBe(now);
    while (loaded[0]!.time > firstOpenTime) {
      const older = await provider.getBars("NEAR/USD", "60", { to: loaded[0]!.time, limit: 2000 });
      expect(older.length).toBeGreaterThan(0);
      loaded.unshift(...older);
    }
    expect(loaded.map(item => item.time)).toEqual(hours);
  });

  it("answers a ranged request with every bar from `from` on, past the limit", async () => {
    const { provider } = setup();
    const bars = await provider.getBars("NEAR/USD", "60", { from: now - 1500 * HOUR, limit: 10 });
    expect(bars[0]!.time).toBe(now - 1500 * HOUR);
    expect(bars.at(-1)!.time).toBe(now);
  });

  it("loads the page holding a far-back range directly, without the latest page", async () => {
    const { provider, fetcher } = setup();
    const to = firstOpenTime + 100 * HOUR;
    const result = await provider.getBars("NEAR/USD", "60", { to, limit: 50 });
    expect(result.at(-1)!.time).toBe(to - HOUR);
    expect(result).toHaveLength(50);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(fetcher.mock.calls[0]![0]).pathname).toBe("/v1/candles");
  });

  it("answers ranges before the first trade with no bars and no requests", async () => {
    const { provider, fetcher } = setup();
    expect(await provider.getBars("NEAR/USD", "60", { to: firstOpenTime, limit: 300 })).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses timeframes the data API does not serve, naming the finest one", async () => {
    const { provider } = setup();
    const refusal = await provider.getBars("NEAR/USD", "15", { limit: 10 }).catch((error: unknown) => error);
    expect(isDataUnavailableError(refusal)).toBe(true);
    expect(refusal).toMatchObject({ reason: "timeframe", finest: "60" });
    expect(await provider.getSymbolInfo!("NEAR/USD")).toMatchObject({ ticker: "NEAR/USD", timezone: "Etc/UTC", session: "24x7", mintick: 0.0001, timeframes: { finest: "60", list: ["60", "1D"] } });
  });

  it("lists the reference market under its USD ticker and the Reference label, never the exchange", async () => {
    const { provider } = setup();
    expect(await provider.listSymbols!()).toEqual([{ ticker: "NEAR/USD", description: "NEAR/USD", type: "crypto", prefix: "Reference" }]);
    expect(JSON.stringify(provider.info!())).not.toMatch(/binance/i);
  });

  it("rejects a latest page from a different revision and reports the chart stale", async () => {
    const { provider, fetcher, onStale } = setup();
    fetcher.mockResolvedValueOnce(latestResponse("1.5", "2"));
    await expect(provider.getBars("NEAR/USD", "60", { limit: 1 })).rejects.toThrow("Market data is unavailable");
    expect(onStale).toHaveBeenCalledOnce();
  });

  it("streams live bars, never older than the last one, and nothing after unsubscribing", () => {
    const { provider, stream } = setup();
    const { onBar, stop, listener } = live(provider, stream);
    listener.candle!(bar(now, "1.6"), false);
    listener.candle!(bar(now - HOUR), false);
    listener.candle!(bar(now + HOUR), false);
    expect(onBar.mock.calls.map(([tick]) => [tick.time, tick.close])).toEqual([[now, 1.6], [now + HOUR, 1.5]]);
    stop();
    listener.candle!(bar(now + 2 * HOUR), false);
    expect(onBar).toHaveBeenCalledTimes(2);
    expect(stream.listeners.size).toBe(0);
  });

  it("refills bars missed while disconnected from the latest page", async () => {
    const { provider, stream, times } = setup();
    const { onBar, listener } = live(provider, stream);
    listener.candle!(bar(now), false);
    times.push(now + HOUR, now + 2 * HOUR);
    listener.resync!();
    await vi.waitFor(() => expect(onBar).toHaveBeenCalledTimes(4));
    expect(onBar.mock.calls.map(([tick]) => tick.time)).toEqual([now, now, now + HOUR, now + 2 * HOUR]);
  });

  it("does not overwrite a newer live candle update with an older reconnect response", async () => {
    const { provider, stream, fetcher } = setup();
    const { onBar, listener } = live(provider, stream);
    const response = Promise.withResolvers<Response>();
    fetcher.mockImplementationOnce(() => response.promise);
    listener.resync!(); listener.candle!(bar(now, "1.9"), false);
    response.resolve(latestResponse("1.6")); await settle();
    expect(onBar.mock.calls.map(([tick]) => tick.close)).toEqual([1.9]);
  });

  it("ignores a superseded reconnect response that arrives after a newer refresh", async () => {
    const { provider, stream, fetcher } = setup();
    const { onBar, listener } = live(provider, stream);
    const first = Promise.withResolvers<Response>(), second = Promise.withResolvers<Response>();
    fetcher.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    listener.resync!(); listener.resync!();
    second.resolve(latestResponse("1.9")); await settle();
    first.resolve(latestResponse("1.6")); await settle();
    expect(onBar.mock.calls.map(([tick]) => tick.close)).toEqual([1.9]);
  });

  it("can recover from an earlier refresh when a newer reconnect request fails", async () => {
    const { provider, stream, fetcher } = setup();
    const { onBar, listener } = live(provider, stream);
    const response = Promise.withResolvers<Response>();
    fetcher.mockImplementationOnce(() => response.promise).mockRejectedValueOnce(new Error("Synthetic refresh unavailable"));
    listener.resync!(); listener.resync!(); await settle();
    response.resolve(latestResponse("1.9")); await settle();
    expect(onBar.mock.calls.map(([tick]) => tick.close)).toEqual([1.9]);
  });

  it("ignores a reconnect response after its subscription ends", async () => {
    const { provider, stream, fetcher } = setup();
    const { onBar, stop, listener } = live(provider, stream);
    const response = Promise.withResolvers<Response>();
    fetcher.mockImplementationOnce(() => response.promise);
    listener.resync!(); stop();
    response.resolve(latestResponse("1.9")); await settle();
    expect(onBar).not.toHaveBeenCalled();
    expect(stream.listeners.size).toBe(0);
  });

  it("reports the chart stale instead of applying reconnect candles from a different revision", async () => {
    const { provider, stream, fetcher, onStale } = setup();
    const { onBar, listener } = live(provider, stream);
    fetcher.mockResolvedValueOnce(latestResponse("1.9", "2"));
    listener.resync!();
    await vi.waitFor(() => expect(onStale).toHaveBeenCalledOnce());
    expect(onBar).not.toHaveBeenCalled();
  });
});

describe("chart feed memory lifecycle", () => {
  it("ends live subscriptions on disposal and opens none afterwards", () => {
    const { source, provider, stream } = setup();
    const { onBar, listener } = live(provider, stream);
    expect(stream.listeners.size).toBe(1);
    source.dispose(); source.dispose();
    expect(stream.listeners.size).toBe(0);
    listener.candle!(bar(now), false);
    expect(onBar).not.toHaveBeenCalled();
    provider.subscribe!("NEAR/USD", "60", onBar);
    expect(stream.listeners.size).toBe(0);
  });

  it("aborts pending history requests and returns nothing from them", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    let signal: AbortSignal | undefined;
    const response = Promise.withResolvers<Response>();
    const api = new DataApi("https://data.test", (_url, init) => { signal = init?.signal as AbortSignal; return response.promise; });
    const source = createBarSource({ api, stream: fakeStream(), revision: "1" });
    const pending = source.history(reference, "1h", { limit: 1 });
    source.dispose();
    expect(signal?.aborted).toBe(true);
    response.resolve(latestResponse("1.5"));
    await expect(pending).resolves.toEqual([]);
  });

  it("evicts old candle pages and refetches them without losing scrollback", async () => {
    const first = pageIndex("1h", firstOpenTime, firstOpenTime);
    const times = Array.from({ length: 36 }, (_, i) => (first + i + 1) * PAGE_SIZE * HOUR);
    const { provider, fetcher } = setup({ times });
    vi.setSystemTime(times.at(-1)!);
    const read = async (time: number) => (await provider.getBars("NEAR/USD", "60", { to: time + 1, limit: 1 }))[0]!.time;
    for (const time of times.slice(0, -1)) expect(await read(time)).toBe(time);
    const before = fetcher.mock.calls.length;
    await read(times.at(-2)!);
    expect(fetcher.mock.calls.length).toBe(before);
    expect(await read(times[0]!)).toBe(times[0]);
    expect(fetcher.mock.calls.length).toBe(before + 1);
  });
});
