import { z } from "zod";
import { timestamp } from "./common";

const price = z.number().positive();

/** Exchanges whose candles Jev reads, by data-API venue. On-chain swaps (Rhea, NEAR Intents) are excluded. */
export const JEV_SOURCES = { binance: "Binance", bybit: "Bybit", okx: "OKX", kucoin: "KuCoin", gate: "Gate", mexc: "MEXC", kraken: "Kraken" } as const;
const JEV_QUOTES = ["USDC", "USDT", "USD"] as const;
export const jevMarketSchema = z.object({ assetId: z.string().min(1), source: z.enum(Object.values(JEV_SOURCES)), quote: z.enum(JEV_QUOTES), symbol: z.string().min(1) });
export type JevMarket = z.infer<typeof jevMarketSchema>;

/** The Jev identity of a data-API market, or undefined when Jev can't analyze it. */
export function jevMarket(market: { venue: string; assetId: string; base: string; quote: string }): JevMarket | undefined {
  const sources: Partial<Record<string, JevMarket["source"]>> = JEV_SOURCES;
  const source = Object.hasOwn(sources, market.venue) ? sources[market.venue] : undefined;
  const quote = JEV_QUOTES.find(item => item === market.quote);
  return source && quote ? { assetId: market.assetId, source, quote, symbol: market.base } : undefined;
}

export const entryPlan = z.object({
  status: z.literal("ready"), model: z.literal("typesafe/jev-1.13"), frameworkVersion: z.literal("v2-multitimeframe"),
  symbol: z.string().min(1),
  market: jevMarketSchema.optional(),
  interval: z.literal("4h"), asOf: timestamp, expiresAt: timestamp, currentPrice: price,
  profile: z.enum(["PROBABILITY_WEIGHTED", "WAIT"]), regime: z.enum(["BULLISH", "NEUTRAL", "BEARISH", "UNCERTAIN"]),
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]), probabilitiesCalibrated: z.literal(false),
  levels: z.array(z.object({ price, zoneLow: price, zoneHigh: price, allocationPercent: z.number().min(0).max(100),
    distancePercent: z.number(), reactionProbability: z.number(), qualityScore: z.number(), touches: timestamp,
    confirmation: z.enum(["AT_ZONE", "APPROACHING", "WAITING"]),
  })),
  evidence: z.object({ closedCandles: timestamp, atrPercent: z.number(), change20Percent: z.number(), rangePositionPercent: z.number(),
    dailyChange20Percent: z.number(), dailyTrend: z.enum(["ABOVE_20_50", "ABOVE_20", "BELOW_20_50", "MIXED"]),
    hourlyChange3Percent: z.number(), hourlyVolumeRatio: z.number(),
  }),
});
