import { z } from "zod";
import type { EntryPlan } from "./entry-analysis";
import { jevMarketSchema } from "@/lib/near/http/schemas/market";

// Saved browser data is untrusted and may outlive the version that wrote it.
export const storedDate = z.number().finite().min(-8.64e15).max(8.64e15);
const finite = z.number().finite();
const storedEntryPlan = z.object({
  status: z.literal("ready"),
  model: z.literal("typesafe/jev-1.13"),
  frameworkVersion: z.literal("v2-multitimeframe"),
  symbol: z.string().min(1),
  market: jevMarketSchema.optional(),
  interval: z.literal("4h"),
  asOf: storedDate,
  expiresAt: storedDate,
  currentPrice: finite.positive(),
  profile: z.enum(["PROBABILITY_WEIGHTED", "WAIT"]),
  regime: z.enum(["BULLISH", "NEUTRAL", "BEARISH", "UNCERTAIN"]),
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  probabilitiesCalibrated: z.literal(false),
  levels: z.array(z.object({
    price: finite.positive(), zoneLow: finite, zoneHigh: finite,
    allocationPercent: finite.min(0).max(100), distancePercent: finite,
    reactionProbability: finite.min(0).max(1), qualityScore: finite,
    touches: finite, confirmation: z.enum(["AT_ZONE", "APPROACHING", "WAITING"]),
  }).refine(level => level.zoneLow < level.zoneHigh)).length(3),
  evidence: z.object({
    closedCandles: finite, atrPercent: finite, change20Percent: finite,
    rangePositionPercent: finite, dailyChange20Percent: finite,
    dailyTrend: z.enum(["ABOVE_20_50", "ABOVE_20", "BELOW_20_50", "MIXED"]),
    hourlyChange3Percent: finite, hourlyVolumeRatio: finite,
  }),
}).refine(plan => plan.market ? plan.symbol === plan.market.symbol + plan.market.quote : plan.symbol === "NEARUSDC") satisfies z.ZodType<EntryPlan>;

export function isStoredEntryPlan(value: unknown): value is EntryPlan {
  return storedEntryPlan.safeParse(value).success;
}
