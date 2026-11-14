// Mirrors backend/data-api/src/candles/intervals.ts; tests/market-data-pages.test.ts checks parity.
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
// 1970-01-01 was a Thursday; weeks open Monday 00:00 UTC.
const FIRST_MONDAY = 4 * DAY;
export const PAGE_SIZE = 1000;

export const INTERVAL_MS: Record<string, number> = {
  "1m": MINUTE, "3m": 3 * MINUTE, "5m": 5 * MINUTE, "15m": 15 * MINUTE, "30m": 30 * MINUTE,
  "1h": HOUR, "2h": 2 * HOUR, "4h": 4 * HOUR, "6h": 6 * HOUR, "8h": 8 * HOUR, "12h": 12 * HOUR,
  "1d": DAY, "3d": 3 * DAY, "1w": 7 * DAY, "1M": 31 * DAY,
};

/** Bucket grid origin: weeks start Monday, 3d buckets start on the UTC day of the market's first minute. */
export function anchorFor(interval: string, firstOpenTime: number) {
  if (interval === "1w") return FIRST_MONDAY;
  if (interval === "3d") return firstOpenTime - (firstOpenTime % DAY);
  return 0;
}

/** Index of the aligned 1000-bar page containing `time`. */
export function pageIndex(interval: string, time: number, firstOpenTime: number) {
  const date = new Date(time);
  const bucket = interval === "1M"
    ? (date.getUTCFullYear() - 1970) * 12 + date.getUTCMonth()
    : Math.floor((time - anchorFor(interval, firstOpenTime)) / INTERVAL_MS[interval]);
  return Math.floor(bucket / PAGE_SIZE);
}
