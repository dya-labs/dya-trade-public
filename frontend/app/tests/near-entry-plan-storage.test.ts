import { describe, expect, it, vi } from "vitest";
import type { EntryPlan } from "@/lib/analysis/entry-analysis";
import {
  ENTRY_PLAN_STORAGE_KEY,
  readActiveEntryPlan,
  storeEntryPlan,
} from "@/lib/analysis/entry-plan-storage";

function plan(overrides: Partial<EntryPlan> = {}): EntryPlan {
  return {
    status: "ready",
    model: "typesafe/jev-1.13",
    frameworkVersion: "v2-multitimeframe",
    symbol: "NEARUSDC",
    interval: "4h",
    asOf: 1_000,
    expiresAt: 10_000,
    currentPrice: 4.2,
    profile: "PROBABILITY_WEIGHTED",
    regime: "NEUTRAL",
    risk: "MEDIUM",
    probabilitiesCalibrated: false,
    levels: [
      { price: 4.1, zoneLow: 4.05, zoneHigh: 4.15, allocationPercent: 34, distancePercent: -2.38, reactionProbability: 0.7, qualityScore: 80, touches: 4, confirmation: "APPROACHING" },
      { price: 4, zoneLow: 3.95, zoneHigh: 4.05, allocationPercent: 33, distancePercent: -4.76, reactionProbability: 0.65, qualityScore: 70, touches: 3, confirmation: "WAITING" },
      { price: 3.9, zoneLow: 3.85, zoneHigh: 3.95, allocationPercent: 33, distancePercent: -7.14, reactionProbability: 0.6, qualityScore: 60, touches: 2, confirmation: "WAITING" },
    ],
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
    ...overrides,
  };
}

function storage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
    removeItem: vi.fn(() => {
      value = null;
    }),
  };
}

describe("entry plan chart persistence", () => {
  it("stores and restores an active plan", () => {
    const target = storage();
    const active = plan();
    storeEntryPlan(target as never, active);

    expect(target.setItem).toHaveBeenCalledWith(
      ENTRY_PLAN_STORAGE_KEY,
      JSON.stringify(active),
    );
    expect(readActiveEntryPlan(target as never, 9_000)).toEqual(active);
  });

  it("removes expired and malformed plans while preserving wait watch levels", () => {
    const expired = storage(JSON.stringify(plan()));
    expect(readActiveEntryPlan(expired as never, 10_000)).toBeNull();
    expect(expired.removeItem).toHaveBeenCalled();

    const malformed = storage("{");
    expect(readActiveEntryPlan(malformed as never, 1)).toBeNull();

    const waiting = storage();
    const waitPlan = plan({
      profile: "WAIT",
      levels: plan().levels.map((level) => ({
        ...level,
        allocationPercent: 0,
      })),
    });
    storeEntryPlan(waiting as never, waitPlan);
    expect(readActiveEntryPlan(waiting as never, 9_000)).toEqual(waitPlan);
  });
});
