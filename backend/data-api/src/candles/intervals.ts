import { DAY, HOUR, MINUTE, type Resolution } from "./kline";

// 1970-01-01 was a Thursday; Binance weeks open Monday 00:00 UTC.
const FIRST_MONDAY = 4 * DAY;

/** All supported intervals expose full history. */
export const INTERVALS: Record<string, { ms: number }> = {
  "1m": { ms: MINUTE }, "3m": { ms: 3 * MINUTE }, "5m": { ms: 5 * MINUTE },
  "15m": { ms: 15 * MINUTE }, "30m": { ms: 30 * MINUTE },
  "1h": { ms: HOUR }, "2h": { ms: 2 * HOUR }, "4h": { ms: 4 * HOUR },
  "6h": { ms: 6 * HOUR }, "8h": { ms: 8 * HOUR }, "12h": { ms: 12 * HOUR },
  "1d": { ms: DAY }, "3d": { ms: 3 * DAY }, "1w": { ms: 7 * DAY },
  "1M": { ms: 31 * DAY },
};

/** Coarsest stored resolution whose candles fit this interval's buckets (1m below an hour, 1h below a day). */
export function coarsestFor(interval: string): Resolution {
  const ms = INTERVALS[interval]!.ms;
  return ms < HOUR ? "1m" : ms < DAY ? "1h" : "1d";
}

/**
 * Bucket grid origin. Binance aligns minute/hour/day buckets to the epoch, weeks to Monday,
 * and 3d buckets to the UTC day of the symbol's first minute (verified per symbol against
 * native klines: BTCUSDT, SOLUSDT and NEARUSDT 3d grids differ). Months are calendar months.
 */
export function anchorFor(interval: string, firstOpenTime: number | null): number {
  if (interval === "1w") return FIRST_MONDAY;
  if (interval === "3d" && firstOpenTime !== null) return firstOpenTime - (firstOpenTime % DAY);
  return 0;
}

export function bucketStart(interval: string, time: number, anchor: number): number {
  if (interval === "1M") {
    const date = new Date(time);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
  const step = INTERVALS[interval]!.ms;
  return anchor + Math.floor((time - anchor) / step) * step;
}

/** Start of the bucket `count` buckets after (or before, if negative) the aligned `start`. */
export function shiftBuckets(interval: string, start: number, count: number): number {
  if (interval !== "1M") return start + count * INTERVALS[interval]!.ms;
  const date = new Date(start);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1);
}

/** ClickHouse expression for the bucket start (ms) of klines_1m.open_time; binds {anchor:Int64}. */
export function bucketSql(interval: string): string {
  if (interval === "1M") return "toUnixTimestamp(toStartOfMonth(open_time)) * 1000";
  const step = INTERVALS[interval]!.ms;
  return `{anchor:Int64} + intDiv(toUnixTimestamp64Milli(open_time) - {anchor:Int64}, ${step}) * ${step}`;
}

export const PAGE_SIZE = 1000;

/** Page indices share the interval's bucket origin, not the request time. */
export function pageIndex(interval: string, time: number, anchor: number): number {
  const date = new Date(time);
  const bucket = interval === "1M"
    ? (date.getUTCFullYear() - 1970) * 12 + date.getUTCMonth()
    : Math.floor((time - anchor) / INTERVALS[interval]!.ms);
  return Math.floor(bucket / PAGE_SIZE);
}

export function pageBounds(interval: string, page: number, anchor: number): { from: number; end: number } {
  return {
    from: shiftBuckets(interval, anchor, page * PAGE_SIZE),
    end: shiftBuckets(interval, anchor, (page + 1) * PAGE_SIZE),
  };
}
