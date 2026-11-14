import { entryPlan as responseSchema } from "@/lib/near/http/schemas/market";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEntryPlan,
  deriveDailyEvidence,
  deriveEntryEvidence,
  deriveHourlyEvidence,
} from "@/lib/analysis/entry-analysis";
import type { Interval, MarketCandle } from "@/lib/analysis/entry-analysis";
import { isStoredEntryPlan } from "@/lib/analysis/entry-plan-schema";
import type { experimental_evaluate as evaluate } from "ai";

function candles(count = 90, intervalMs = 4 * 60 * 60 * 1000): MarketCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index / 4) * 0.18;
    const trend = index * 0.006;
    const close = 3.5 + trend + wave;
    return {
      time: (index * intervalMs) / 1000,
      open: close - 0.02,
      high: close + 0.08,
      low: close - 0.09,
      close,
      volume: 1000 + index * 5,
      closeTime: (index + 1) * intervalMs - 1,
    };
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("NEAR multi-timeframe entry analysis", () => {
  it("derives descending 4h support zones with quality evidence", () => {
    const rows = candles();
    const now = rows.at(-1)!.closeTime + 1;
    const evidence = deriveEntryEvidence(rows, now);

    expect(evidence.levels).toHaveLength(3);
    expect(evidence.levels[0].price).toBeGreaterThan(evidence.levels[1].price);
    expect(evidence.levels[1].price).toBeGreaterThan(evidence.levels[2].price);
    expect(evidence.levels.every((level) => level.price < evidence.currentPrice)).toBe(true);
    expect(evidence.levels.every((level) => level.zoneLow < level.zoneHigh)).toBe(true);
    expect(evidence.levels.every((level) => level.qualityScore >= 0)).toBe(true);
  });

  it("derives daily regime and hourly confirmation inputs from closed bars", () => {
    const dailyRows = candles(90, 24 * 60 * 60 * 1000);
    const hourlyRows = candles(90, 60 * 60 * 1000);
    const now = dailyRows.at(-1)!.closeTime + 1;
    const levels = deriveEntryEvidence(candles(), candles().at(-1)!.closeTime + 1);

    expect(deriveDailyEvidence(dailyRows, now).dailyTrend).toMatch(
      /ABOVE|BELOW|MIXED/,
    );
    const hourly = deriveHourlyEvidence(
      hourlyRows,
      levels.levels,
      levels.atr,
      now,
    );
    expect(hourly.confirmations).toHaveLength(3);
    expect(hourly.volumeRatio).toBeGreaterThan(0);
  });

  it("weights allocations from Jev reaction probabilities and requests all timeframes", async () => {
    vi.stubEnv("NEAR_AI_API_KEY", "test-only");
    const byInterval: Record<Interval, MarketCandle[]> = {
      "1h": candles(90, 60 * 60 * 1000),
      "4h": candles(),
      "1d": candles(90, 24 * 60 * 60 * 1000),
    };
    const now = byInterval["1d"].at(-1)!.closeTime + 1;
    const market = { get: vi.fn(async (interval: Interval) => ({ candles: byInterval[interval] })) };
    const evaluator = vi.fn(async () => ({
      answers: {
        level1Reaction: { type: "boolean", probability: 0.72 },
        level2Reaction: { type: "boolean", probability: 0.64 },
        level3Reaction: { type: "boolean", probability: 0.58 },
        regime: { type: "choice", choice: "NEUTRAL" },
        risk: { type: "choice", choice: "MEDIUM" },
      },
    })) as unknown as typeof evaluate;

    const plan = await createEntryPlan(market as never, now, evaluator);
    expect(() => responseSchema.parse(JSON.parse(JSON.stringify(plan)))).not.toThrow();

    expect(plan.frameworkVersion).toBe("v2-multitimeframe");
    expect(plan.probabilitiesCalibrated).toBe(false);
    expect(plan.levels.reduce((sum, level) => sum + level.allocationPercent, 0)).toBe(100);
    expect(plan.levels[0].reactionProbability).toBe(0.72);
    expect(market.get).toHaveBeenCalledWith("1d");
    expect(market.get).toHaveBeenCalledWith("4h");
    expect(market.get).toHaveBeenCalledWith("1h");
  });

  it("returns a wait plan when every reaction probability is weak", async () => {
    vi.stubEnv("NEAR_AI_API_KEY", "test-only");
    const rows = candles(90, 24 * 60 * 60 * 1000);
    const now = rows.at(-1)!.closeTime + 1;
    const market = { get: vi.fn(async () => ({ candles: rows })) };
    const evaluator = vi.fn(async () => ({
      answers: {
        level1Reaction: { type: "boolean", probability: 0.5 },
        level2Reaction: { type: "boolean", probability: 0.48 },
        level3Reaction: { type: "boolean", probability: 0.45 },
        regime: { type: "choice", choice: "BEARISH" },
        risk: { type: "choice", choice: "HIGH" },
      },
    })) as unknown as typeof evaluate;

    const plan = await createEntryPlan(market as never, now, evaluator);
    expect(() => responseSchema.parse(JSON.parse(JSON.stringify(plan)))).not.toThrow();
    expect(plan.profile).toBe("WAIT");
    expect(plan.levels.map((level) => level.allocationPercent)).toEqual([0, 0, 0]);
  });

  it("fails closed when Jev credentials are absent", async () => {
    vi.stubEnv("NEAR_AI_API_KEY", "");
    const market = { get: vi.fn() };
    await expect(createEntryPlan(market)).rejects.toThrow("Jev is not configured");
    expect(market.get).not.toHaveBeenCalled();
  });
});

it.each([["Binance", "USDT"], ["Gate", "USDT"], ["Kraken", "USD"]] as const)("preserves sub-cent token support zones and returns a %s %s plan the client accepts", async (source, quote) => {
  vi.stubEnv("NEAR_AI_API_KEY", "test-only");
  const rows = candles(90, 86400000).map(c => ({ ...c, open: c.open * 1e-7, high: c.high * 1e-7, low: c.low * 1e-7, close: c.close * 1e-7 }));
  const evaluator = vi.fn(async () => ({ answers: {
    level1Reaction: { probability: 0.7 }, level2Reaction: { probability: 0.6 }, level3Reaction: { probability: 0.5 },
    regime: { choice: "NEUTRAL" }, risk: { choice: "MEDIUM" },
  } })) as unknown as typeof evaluate;
  const identity = { assetId: "tiny-token", symbol: "TINY", source, quote };
  const result = await createEntryPlan({ get: async () => ({ candles: rows }) }, rows.at(-1)!.closeTime + 1, evaluator, identity);
  expect(result.symbol).toBe(`TINY${quote}`);
  expect(result.market).toEqual(identity);
  expect(result.levels.every(level => level.price > 0 && level.zoneLow > 0 && level.zoneLow < level.zoneHigh)).toBe(true);
  expect(result.currentPrice).toBeLessThan(0.0001);
  expect(vi.mocked(evaluator).mock.calls[0][0].state).toMatchObject({ asset: `TINY priced in ${quote}`, referenceSource: source });
  // The browser validates the Worker's JSON with this schema; a plan it rejects never reaches the chart.
  expect(() => responseSchema.parse(JSON.parse(JSON.stringify(result)))).not.toThrow();
  expect(isStoredEntryPlan(result)).toBe(true);
});
