import { experimental_evaluate as evaluate } from "ai";
import { AppError, ErrorCode } from "@/lib/near/domain/errors";
import type { JevMarket } from "@/lib/near/http/schemas/market";
import { JEV_MODEL, jevEvaluationModel, nearAiApiKey } from "./near-ai";

export type Interval = "1d" | "4h" | "1h";
export interface MarketCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export type AllocationProfile = "PROBABILITY_WEIGHTED" | "WAIT";

export type EntryPlan = {
  status: "ready";
  model: typeof JEV_MODEL;
  frameworkVersion: "v2-multitimeframe";
  symbol: string;
  market?: JevMarket;
  interval: "4h";
  asOf: number;
  expiresAt: number;
  currentPrice: number;
  profile: AllocationProfile;
  regime: "BULLISH" | "NEUTRAL" | "BEARISH" | "UNCERTAIN";
  risk: "LOW" | "MEDIUM" | "HIGH";
  probabilitiesCalibrated: false;
  levels: Array<{
    price: number;
    zoneLow: number;
    zoneHigh: number;
    allocationPercent: number;
    distancePercent: number;
    reactionProbability: number;
    qualityScore: number;
    touches: number;
    confirmation: "AT_ZONE" | "APPROACHING" | "WAITING";
  }>;
  evidence: {
    closedCandles: number;
    atrPercent: number;
    change20Percent: number;
    rangePositionPercent: number;
    dailyChange20Percent: number;
    dailyTrend: "ABOVE_20_50" | "ABOVE_20" | "BELOW_20_50" | "MIXED";
    hourlyChange3Percent: number;
    hourlyVolumeRatio: number;
  };
};

function round(value: number, digits?: number) {
  return digits === undefined ? Number(value.toPrecision(12)) : Number(value.toFixed(digits));
}

function closedCandles(candles: MarketCandle[], now: number, minimum: number) {
  const closed = candles.filter((candle) => candle.closeTime < now);
  if (closed.length < minimum) throw new AppError(ErrorCode.NotEnoughClosedMarketData);
  return closed;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function deriveEntryEvidence(candles: MarketCandle[], now: number) {
  const closed = closedCandles(candles, now, 60);
  const sample = closed.slice(-180);
  const latest = sample.at(-1)!;
  const ranges = sample.slice(-20).map((candle, index, rows) => {
    const previous = rows[index - 1]?.close ?? candle.open;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous),
      Math.abs(candle.low - previous),
    );
  });
  const atr = average(ranges);
  const pivots = sample
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => {
      if (index < 2 || index > sample.length - 3) return false;
      return sample
        .slice(index - 2, index + 3)
        .every((other) => candle.low <= other.low);
    })
    .map(({ candle, index }) => ({ price: candle.low, index }))
    .filter(({ price }) => price < latest.close);

  const candidates = pivots
    .sort((a, b) => b.index - a.index)
    .reduce<Array<{ price: number; index: number }>>((levels, pivot) => {
      if (!levels.some((level) => Math.abs(level.price - pivot.price) < atr * 0.6))
        levels.push(pivot);
      return levels;
    }, [])
    .sort((a, b) => b.price - a.price)
    .slice(0, 3);

  for (const multiple of [0.75, 1.5, 2.5]) {
    if (candidates.length >= 3) break;
    const price = latest.close - atr * multiple;
    if (price > 0 && !candidates.some((level) => Math.abs(level.price - price) < atr * 0.4))
      candidates.push({ price, index: sample.length - 1 });
  }
  candidates.sort((a, b) => b.price - a.price);
  if (candidates.length !== 3) throw new AppError(ErrorCode.UnableToDeriveEntryLevels);

  const levels = candidates.map((candidate) => {
    const touches = sample.filter(
      (candle) =>
        candle.low <= candidate.price + atr * 0.35 &&
        candle.high >= candidate.price - atr * 0.35,
    ).length;
    const recency = candidate.index / Math.max(1, sample.length - 1);
    const qualityScore = Math.min(100, touches * 12 + recency * 28);
    return {
      price: candidate.price,
      zoneLow: Math.max(candidate.price * 0.01, candidate.price - atr * 0.35),
      zoneHigh: candidate.price + atr * 0.35,
      touches,
      qualityScore,
    };
  });

  const lookback = sample.slice(-20);
  const high = Math.max(...lookback.map((candle) => candle.high));
  const low = Math.min(...lookback.map((candle) => candle.low));
  return {
    currentPrice: latest.close,
    levels,
    closedCandles: sample.length,
    atr,
    atrPercent: (atr / latest.close) * 100,
    change20Percent: ((latest.close / lookback[0].open) - 1) * 100,
    rangePositionPercent:
      high === low ? 50 : ((latest.close - low) / (high - low)) * 100,
    asOf: latest.closeTime,
  };
}

export function deriveDailyEvidence(candles: MarketCandle[], now: number) {
  const sample = closedCandles(candles, now, 55).slice(-90);
  const latest = sample.at(-1)!;
  const sma20 = average(sample.slice(-20).map((candle) => candle.close));
  const sma50 = average(sample.slice(-50).map((candle) => candle.close));
  const dailyTrend =
    latest.close > sma20 && sma20 > sma50
      ? "ABOVE_20_50"
      : latest.close > sma20
        ? "ABOVE_20"
        : latest.close < sma20 && sma20 < sma50
          ? "BELOW_20_50"
          : "MIXED";
  return {
    change20Percent:
      ((latest.close / sample.at(-20)!.open) - 1) * 100,
    dailyTrend: dailyTrend as EntryPlan["evidence"]["dailyTrend"],
  };
}

export function deriveHourlyEvidence(
  candles: MarketCandle[],
  levels: ReturnType<typeof deriveEntryEvidence>["levels"],
  atr4h: number,
  now: number,
) {
  const sample = closedCandles(candles, now, 24).slice(-72);
  const latest = sample.at(-1)!;
  const recentVolume = average(sample.slice(-3).map((candle) => candle.volume));
  const baselineVolume = average(sample.slice(-23, -3).map((candle) => candle.volume));
  return {
    change3Percent:
      ((latest.close / sample.at(-3)!.open) - 1) * 100,
    volumeRatio: baselineVolume > 0 ? recentVolume / baselineVolume : 1,
    confirmations: levels.map((level) => {
      if (latest.close >= level.zoneLow && latest.close <= level.zoneHigh)
        return "AT_ZONE" as const;
      if (
        latest.close > level.zoneHigh &&
        latest.close - level.zoneHigh <= atr4h * 1.5
      )
        return "APPROACHING" as const;
      return "WAITING" as const;
    }),
  };
}

function allocations(probabilities: number[], qualityScores: number[]) {
  if (Math.max(...probabilities) < 0.55) return [0, 0, 0];
  const raw = probabilities.map(
    (probability, index) =>
      Math.max(0, probability - 0.45) * (0.5 + qualityScores[index] / 200),
  );
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [0, 0, 0];
  const exact = raw.map((value) => (value / total) * 100);
  const result = exact.map(Math.floor);
  let remaining = 100 - result.reduce((sum, value) => sum + value, 0);
  exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
    .forEach(({ index }) => {
      if (remaining > 0) {
        result[index] += 1;
        remaining -= 1;
      }
    });
  return result;
}

type JevAnswers = {
  level1Reaction: { probability: number };
  level2Reaction: { probability: number };
  level3Reaction: { probability: number };
  regime: { choice: EntryPlan["regime"] };
  risk: { choice: EntryPlan["risk"] };
};

function jevApiKey() {
  const apiKey = nearAiApiKey();
  if (!apiKey) throw new AppError(ErrorCode.JevIsNotConfigured);
  return apiKey;
}

export function assertJevConfigured() {
  jevApiKey();
}

export async function createEntryPlan(
  market: { get(interval: Interval): Promise<{ candles: MarketCandle[] }> },
  now = Date.now(),
  evaluator: typeof evaluate = evaluate,
  identity?: NonNullable<EntryPlan["market"]>,
): Promise<EntryPlan> {
  const apiKey = jevApiKey();

  const [dailySnapshot, fourHourSnapshot, hourlySnapshot] = await Promise.all([
    market.get("1d"),
    market.get("4h"),
    market.get("1h"),
  ]);
  const fourHour = deriveEntryEvidence(fourHourSnapshot.candles, now);
  const daily = deriveDailyEvidence(dailySnapshot.candles, now);
  const hourly = deriveHourlyEvidence(
    hourlySnapshot.candles,
    fourHour.levels,
    fourHour.atr,
    now,
  );
  const candidateLevels = fourHour.levels.map((level, index) => ({
    id: index + 1,
    price: round(level.price),
    zoneLow: round(level.zoneLow),
    zoneHigh: round(level.zoneHigh),
    distancePercent: round(((level.price / fourHour.currentPrice) - 1) * 100, 2),
    touches: level.touches,
    qualityScore: round(level.qualityScore, 1),
    hourlyConfirmation: hourly.confirmations[index],
  }));
  const reactionDefinition =
    "If price trades into this zone within 72 hours, estimate the probability that it rises by at least one current 4h ATR before a 4h close falls one ATR below the zone.";

  const result = await evaluator({
    model: jevEvaluationModel(apiKey),
    state: {
      asset: identity ? `${identity.symbol} priced in ${identity.quote}` : "NEAR priced in USDC",
      referenceSource: identity?.source ?? "Binance",
      purpose: "Read-only staged spot entry planning; never execution",
      currentPrice: round(fourHour.currentPrice),
      daily: {
        trend: daily.dailyTrend,
        change20Percent: round(daily.change20Percent, 2),
      },
      fourHour: {
        atrPercent: round(fourHour.atrPercent, 2),
        change20Percent: round(fourHour.change20Percent, 2),
        rangePositionPercent: round(fourHour.rangePositionPercent, 2),
        candidateLevels,
      },
      hourly: {
        change3Percent: round(hourly.change3Percent, 2),
        volumeRatio: round(hourly.volumeRatio, 2),
      },
      probabilityDefinition: reactionDefinition,
    },
    questions: {
      level1Reaction: {
        type: "boolean",
        instructions: reactionDefinition + " Evaluate candidate level 1 only.",
      },
      level2Reaction: {
        type: "boolean",
        instructions: reactionDefinition + " Evaluate candidate level 2 only.",
      },
      level3Reaction: {
        type: "boolean",
        instructions: reactionDefinition + " Evaluate candidate level 3 only.",
      },
      regime: {
        type: "choice",
        criteria: {
          BULLISH: "Daily and 4h positive trend evidence dominates.",
          NEUTRAL: "Trend evidence is mixed or range-bound.",
          BEARISH: "Daily and 4h negative trend evidence dominates.",
          UNCERTAIN: "The supplied evidence is insufficient or contradictory.",
        },
        instructions: "Classify the multi-timeframe market regime from only the supplied evidence.",
      },
      risk: {
        type: "choice",
        criteria: {
          LOW: "Relatively low entry risk within this market state.",
          MEDIUM: "Meaningful but moderate entry risk.",
          HIGH: "High volatility, downside, or uncertainty makes entry risky.",
        },
        instructions: "Classify staged spot-entry risk from only the supplied evidence.",
      },
    },
  });
  const answers = result.answers as JevAnswers;
  const probabilities = [
    answers.level1Reaction.probability,
    answers.level2Reaction.probability,
    answers.level3Reaction.probability,
  ];
  if (
    probabilities.some(
      (probability) =>
        !Number.isFinite(probability) || probability < 0 || probability > 1,
    )
  )
    throw new Error("Jev returned an invalid reaction probability");
  const percentages = allocations(
    probabilities,
    fourHour.levels.map((level) => level.qualityScore),
  );
  const profile = percentages.some((value) => value > 0)
    ? "PROBABILITY_WEIGHTED"
    : "WAIT";

  return {
    status: "ready",
    model: JEV_MODEL,
    frameworkVersion: "v2-multitimeframe",
    symbol: identity ? `${identity.symbol}${identity.quote}` : "NEARUSDC",
    ...(identity ? { market: identity } : {}),
    interval: "4h",
    asOf: fourHour.asOf,
    expiresAt: fourHour.asOf + 4 * 60 * 60 * 1000,
    currentPrice: round(fourHour.currentPrice),
    profile,
    regime: answers.regime.choice,
    risk: answers.risk.choice,
    probabilitiesCalibrated: false,
    levels: fourHour.levels.map((level, index) => ({
      price: round(level.price),
      zoneLow: round(level.zoneLow),
      zoneHigh: round(level.zoneHigh),
      allocationPercent: percentages[index],
      distancePercent: round(((level.price / fourHour.currentPrice) - 1) * 100, 2),
      reactionProbability: round(probabilities[index], 3),
      qualityScore: round(level.qualityScore, 1),
      touches: level.touches,
      confirmation: hourly.confirmations[index],
    })),
    evidence: {
      closedCandles: fourHour.closedCandles,
      atrPercent: round(fourHour.atrPercent, 2),
      change20Percent: round(fourHour.change20Percent, 2),
      rangePositionPercent: round(fourHour.rangePositionPercent, 2),
      dailyChange20Percent: round(daily.change20Percent, 2),
      dailyTrend: daily.dailyTrend,
      hourlyChange3Percent: round(hourly.change3Percent, 2),
      hourlyVolumeRatio: round(hourly.volumeRatio, 2),
    },
  };
}
