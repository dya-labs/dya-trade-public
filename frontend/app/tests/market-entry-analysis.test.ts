import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarketEntryPlan, loadAnalysisMarket } from "@/lib/analysis/market-entry-analysis";
import { DataApi } from "@/lib/market-data/api";

const asset = { assetId: "nep141:btc.omft.near", symbol: "BTC", blockchain: "btc", decimals: 8 };
const HOUR = 3_600_000;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const row = (time: number) => [time, "10", "12", "9", "11", "5", "55", 3, "2", "22"];

function api({ quote = "USDT", venue = "binance", primaryMarket = "binance:BTCUSDT" as string | null, latestBars = 200, marketAssetId = asset.assetId, latestRevision = "7" } = {}) {
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input);
    const interval = url.searchParams.get("interval") ?? "";
    const step = { "1d": 24 * HOUR, "4h": 4 * HOUR, "1h": HOUR }[interval] ?? HOUR;
    if (url.pathname === "/v1/meta") return Response.json({ serverTime: 0, intervals: ["1h", "4h", "1d"], pageSize: 1000, revision: "7" });
    if (url.pathname === "/v1/assets") return Response.json({ assets: [{ assetId: asset.assetId, symbol: "BTC", primaryMarket, alternatives: [], sourceLabel: "Binance", unavailableReason: null, sources: [] }] });
    if (url.pathname === "/v1/markets") return Response.json({ markets: [{ id: "binance:BTCUSDT", venue, sourceLabel: "Label from the API", symbol: "BTCUSDT", base: "BTC", quote, assetId: marketAssetId, firstOpenTime: 0, intervals: ["1h", "4h", "1d"] }] });
    if (url.pathname === "/v1/candles/latest") return Response.json({ market: "binance:BTCUSDT", interval, revision: latestRevision, page: 5, prev: 4, final: false, bars: Array.from({ length: latestBars }, (_, index) => row(5000 * step + index * step)) });
    if (url.pathname === "/v1/candles") return Response.json({ market: "binance:BTCUSDT", interval, revision: "7", page: 4, prev: 3, final: true, bars: Array.from({ length: 1000 }, (_, index) => row(4000 * step + index * step)) });
    return new Response(null, { status: 404 });
  });
  return { fetcher, api: new DataApi("https://data.test", fetcher) };
}

describe("Jev candles from the data API", () => {
  it("reports missing Jev configuration before requesting any market data", async () => {
    vi.stubEnv("NEAR_AI_API_KEY", "");
    const fetch = vi.fn().mockRejectedValue(new Error("Synthetic market transport unavailable"));
    vi.stubGlobal("fetch", fetch);
    await expect(createMarketEntryPlan(asset)).rejects.toThrow("Jev is not configured.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows NEAR_AI_API_KEY configuration to proceed to market loading without calling a live evaluator", async () => {
    vi.stubEnv("NEAR_AI_API_KEY", "synthetic-only");
    const fetch = vi.fn().mockRejectedValue(new Error("Synthetic market transport unavailable"));
    vi.stubGlobal("fetch", fetch);
    await expect(createMarketEntryPlan(asset)).rejects.toThrow("Synthetic market transport unavailable");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("binds analysis to the asset's primary market and converts bars to closed-candle evidence", async () => {
    const { api: client, fetcher } = api();
    const { identity, market } = await loadAnalysisMarket(asset, client);
    expect(identity).toEqual({ assetId: asset.assetId, source: "Binance", symbol: "BTC", quote: "USDT" });
    expect(fetcher.mock.calls.map(([url]) => new URL(url).searchParams.get("interval")).filter(Boolean)).toEqual(["1d", "4h", "1h"]);
    const [first] = (await market.get("4h")).candles;
    expect(first).toEqual({ time: 5000 * 4 * HOUR / 1000, open: 10, high: 12, low: 9, close: 11, volume: 5, closeTime: 5001 * 4 * HOUR - 1 });
  });

  it("prepends the previous page when the open page is too short for the evidence window", async () => {
    const { api: client, fetcher } = api({ latestBars: 2 });
    const candles = (await (await loadAnalysisMarket(asset, client)).market.get("4h")).candles;
    expect(candles).toHaveLength(1002);
    expect(candles.every((candle, index) => index === 0 || candle.time > candles[index - 1].time)).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => url.includes("page=4") && url.includes("rev=7"))).toBe(true);
  });

  it.each([2, 200])("rejects a changed latest-candle revision before building analysis evidence (bars=%s)", async latestBars => {
    const { api: client, fetcher } = api({ latestBars, latestRevision: "8" });
    await expect(loadAnalysisMarket(asset, client)).rejects.toThrow("Market data is unavailable");
    expect(fetcher.mock.calls.every(([url]) => new URL(url).pathname !== "/v1/candles")).toBe(true);
  });

  it.each([["gate", "USDT", "Gate"], ["kraken", "USD", "Kraken"], ["okx", "USDC", "OKX"]] as const)("accepts a %s %s exchange market as the plan's source", async (venue, quote, source) => {
    const { identity } = await loadAnalysisMarket(asset, api({ venue, quote }).api);
    expect(identity).toEqual({ assetId: asset.assetId, source, symbol: "BTC", quote });
  });

  it("fails closed for assets without a supported market", async () => {
    await expect(loadAnalysisMarket(asset, api({ primaryMarket: null }).api)).rejects.toThrow("exchange market");
    await expect(loadAnalysisMarket(asset, api({ quote: "BTC" }).api)).rejects.toThrow("exchange market");
    await expect(loadAnalysisMarket(asset, api({ venue: "rhea", quote: "USD" }).api)).rejects.toThrow("exchange market");
    await expect(loadAnalysisMarket(asset, api({ venue: "intents", quote: "USD" }).api)).rejects.toThrow("exchange market");
    await expect(loadAnalysisMarket(asset, api({ venue: "constructor" }).api)).rejects.toThrow("exchange market");
  });
  it("rejects a primary market assigned to another asset before loading analysis candles", async () => {
    const { api: client, fetcher } = api({ marketAssetId: "synthetic-other-asset" });
    await expect(loadAnalysisMarket(asset, client)).rejects.toThrow("exchange market");
    expect(fetcher).toHaveBeenCalledTimes(3);expect(fetcher.mock.calls.every(([url]) => !new URL(url).pathname.includes("candles"))).toBe(true);
  });
});
