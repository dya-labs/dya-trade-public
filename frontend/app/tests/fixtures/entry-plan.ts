import type { EntryPlan } from "@/lib/analysis/entry-analysis";

export function entryPlan(asOf: number): EntryPlan {
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
