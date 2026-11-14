import { analysisStorage } from "@/lib/analysis/market-storage";
import { AUTO_ENTRY_ANALYSIS_KEY } from "@/lib/analysis/auto-analysis";
import { describe, expect, it } from "vitest";
import type { EntryPlan } from "@/lib/analysis/entry-analysis";
import {
  ENTRY_ANALYSIS_HISTORY_KEY,
  ENTRY_ANALYSIS_HISTORY_LIMIT,
  SELECTED_ENTRY_ANALYSIS_KEY,
  readDisplayedEntryPlan,
  readEntryAnalysisHistory,
  selectEntryAnalysis,
  storeEntryAnalysis,
} from "@/lib/analysis/entry-analysis-history";

function plan(asOf: number): EntryPlan {
  return {
    status: "ready",
    model: "typesafe/jev-1.13",
    frameworkVersion: "v2-multitimeframe",
    symbol: "NEARUSDC",
    interval: "4h",
    asOf,
    expiresAt: asOf + 1_000,
    currentPrice: 4.2,
    profile: "PROBABILITY_WEIGHTED",
    regime: "NEUTRAL",
    risk: "MEDIUM",
    probabilitiesCalibrated: false,
    levels: [4.1, 4, 3.9].map((price, index) => ({
      price,
      zoneLow: price - 0.05,
      zoneHigh: price + 0.05,
      allocationPercent: index === 0 ? 34 : 33,
      distancePercent: -2 - index,
      reactionProbability: 0.7 - index * 0.05,
      qualityScore: 80 - index * 10,
      touches: 4 - index,
      confirmation: index === 0 ? "APPROACHING" : "WAITING",
    })),
    evidence: {
      closedCandles: 100,
      atrPercent: 3,
      change20Percent: 2,
      rangePositionPercent: 50,
      dailyChange20Percent: 3,
      dailyTrend: "ABOVE_20_50",
      hourlyChange3Percent: -1,
      hourlyVolumeRatio: 1.2,
    },
  };
}

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("entry analysis history", () => {
  it("stores a bounded newest-first history and selects the latest result", () => {
    const target = storage();
    for (let index = 0; index < ENTRY_ANALYSIS_HISTORY_LIMIT + 2; index += 1)
      storeEntryAnalysis(target, plan(index + 1), index % 2 ? "auto" : "manual", 10_000 + index);

    const history = readEntryAnalysisHistory(target);
    expect(history).toHaveLength(ENTRY_ANALYSIS_HISTORY_LIMIT);
    expect(history[0].plan.asOf).toBe(ENTRY_ANALYSIS_HISTORY_LIMIT + 2);
    expect(target.getItem(SELECTED_ENTRY_ANALYSIS_KEY)).toBe(history[0].id);
    expect(target.getItem(ENTRY_ANALYSIS_HISTORY_KEY)).toBeTruthy();
  });

  it("restores a selected historical plan even after its execution window expired", () => {
    const target = storage();
    const first = storeEntryAnalysis(target, plan(1_000), "manual", 2_000);
    storeEntryAnalysis(target, plan(3_000), "auto", 4_000);
    selectEntryAnalysis(target, first.id);

    expect(readDisplayedEntryPlan(target, 100_000)?.asOf).toBe(1_000);
  });
});


it("isolates token toggles, selected history and plans while retaining legacy NEAR settings", () => {
  const target = storage();
  const near = analysisStorage(target, "nep141:wrap.near");
  const btc = analysisStorage(target, "nep141:btc.omft.near");
  const sol = analysisStorage(target, "nep141:sol.omft.near");
  near.setItem(AUTO_ENTRY_ANALYSIS_KEY, "true");
  btc.setItem(AUTO_ENTRY_ANALYSIS_KEY, "false");
  expect(target.getItem(AUTO_ENTRY_ANALYSIS_KEY)).toBe("true");
  expect(sol.getItem(AUTO_ENTRY_ANALYSIS_KEY)).toBeNull();
  expect(btc.getItem(AUTO_ENTRY_ANALYSIS_KEY)).toBe("false");
  const btcPlan: EntryPlan = { ...plan(100), symbol: "BTCUSDT", market: { assetId: "nep141:btc.omft.near", symbol: "BTC", quote: "USDT", source: "Binance" } };
  storeEntryAnalysis(btc, btcPlan, "manual");
  storeEntryAnalysis(near, plan(200), "manual");
  expect(readDisplayedEntryPlan(btc)?.symbol).toBe("BTCUSDT");
  expect(readDisplayedEntryPlan(near)?.symbol).toBe("NEARUSDC");
  expect(readEntryAnalysisHistory(sol)).toEqual([]);
});

it.each([
  ["missing regime", { regime: undefined }],
  ["missing evidence", { evidence: undefined }],
  ["empty levels", { levels: [] }],
  ["null level", { levels: [null, null, null] }],
  ["invalid momentum", { evidence: { ...plan(100).evidence, change20Percent: "oops" } }],
  ["on-chain market", { market: { assetId: "rhea", source: "Rhea", symbol: "RHEA", quote: "USD" }, symbol: "RHEAUSD" }],
  ["unsupported quote", { market: { assetId: "btc", source: "Binance", symbol: "BTC", quote: "EUR" }, symbol: "BTCEUR" }],
])("ignores malformed history plans while retaining valid records: %s", (_label, patch) => {
  const target = storage();
  const valid = storeEntryAnalysis(target, plan(100), "manual", 200);
  target.setItem(ENTRY_ANALYSIS_HISTORY_KEY, JSON.stringify([{ ...valid, id: "broken", plan: { ...valid.plan, ...patch } }, valid]));
  expect(readEntryAnalysisHistory(target)).toEqual([valid]);
});

it("keeps plans from every Jev exchange source", () => {
  const target = storage();
  const gate: EntryPlan = { ...plan(100), symbol: "RHEAUSDT", market: { assetId: "nep141:token.rhealab.near", source: "Gate", symbol: "RHEA", quote: "USDT" } };
  const kraken: EntryPlan = { ...plan(100), symbol: "ALEOUSD", market: { assetId: "aleo", source: "Kraken", symbol: "ALEO", quote: "USD" } };
  const stored = [storeEntryAnalysis(target, gate, "manual", 200), storeEntryAnalysis(target, kraken, "manual", 300)];
  expect(readEntryAnalysisHistory(target).map(record => record.plan)).toEqual(expect.arrayContaining(stored.map(record => record.plan)));
});

it("rejects history dates outside the JavaScript date range", () => {
  const target = storage();
  const valid = storeEntryAnalysis(target, plan(100), "manual", 200);
  target.setItem(ENTRY_ANALYSIS_HISTORY_KEY, JSON.stringify([{ ...valid, createdAt: 9e15 }, valid]));
  expect(readEntryAnalysisHistory(target)).toEqual([valid]);
});
