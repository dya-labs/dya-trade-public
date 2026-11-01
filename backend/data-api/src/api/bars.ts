import type { RedisClient } from "bun";
import { foldBar } from "../candles/bar";
import { bucketStart, shiftBuckets } from "../candles/intervals";
import type { Kline } from "../candles/kline";
import type { CandleStore, MarketRef } from "../candles/store";
import { liveKeys } from "../live/protocol";

/**
 * ClickHouse holds every minute before the sync watermark W; Redis holds the minutes after it
 * (streamed, not yet persisted). Buckets entirely before W come from ClickHouse alone. The
 * bucket containing W starts from ClickHouse's partial aggregate (the seed) and folds Redis
 * minutes on top; later buckets are folded from Redis minutes only.
 */
export type Tail = { start: number; seed: Kline | undefined; cutoff: number; minutes: Kline[] };

export class BarReader {
  constructor(private readonly deps: { store: CandleStore; redis: RedisClient }) {}

  /** Redis minutes at or after `from`, ascending. Read before ClickHouse so nothing falls between. */
  async recent(market: MarketRef, from: number): Promise<Kline[]> {
    const hash = await this.deps.redis.hgetall(liveKeys(market.venue).recent(market.symbol));
    return Object.values(hash).map(json => JSON.parse(json) as Kline).filter(kline => kline.openTime >= from).sort((a, b) => a.openTime - b.openTime);
  }

  /**
   * Bars with openTime in [from, end), both bucket-aligned, ascending. `final` is true when
   * the whole range lies below the sync watermark: every bar is stored, closed, and cacheable.
   */
  async read(market: MarketRef, interval: string, anchor: number, from: number, end: number): Promise<{ bars: Kline[]; final: boolean }> {
    if (from >= end) return { bars: [], final: true };
    const recent = await this.recent(market, from);
    const coverage = await this.deps.store.coverage(market);
    const watermark = Math.min(coverage.syncedTo, end);
    const tailStart = Math.max(from, bucketStart(interval, watermark, anchor));
    const stored = watermark > from ? await this.deps.store.bars(market, coverage, interval, anchor, from, watermark) : [];
    const bars = stored.filter(bar => bar.openTime < tailStart);
    const seed = stored.find(bar => bar.openTime === tailStart);
    const live = recent.filter(kline => kline.openTime >= watermark && kline.openTime < end);
    for (let start = tailStart; start < end; start = shiftBuckets(interval, start, 1)) {
      const next = shiftBuckets(interval, start, 1);
      const bar = foldBar(start, start === tailStart ? seed : undefined, live.filter(kline => kline.openTime >= start && kline.openTime < next));
      if (bar) bars.push(bar);
      if (!live.some(kline => kline.openTime >= next)) break;
    }
    return { bars, final: end <= coverage.syncedTo };
  }

  /** Seed and Redis minutes for one bucket, for incremental folding of live updates. */
  async tail(market: MarketRef, interval: string, anchor: number, start: number): Promise<Tail> {
    const end = shiftBuckets(interval, start, 1);
    const recent = await this.recent(market, start);
    const coverage = await this.deps.store.coverage(market);
    const cutoff = Math.max(start, Math.min(coverage.syncedTo, end));
    const [seed] = cutoff > start ? await this.deps.store.bars(market, coverage, interval, anchor, start, cutoff) : [];
    return { start, seed, cutoff, minutes: recent.filter(kline => kline.openTime >= cutoff && kline.openTime < end) };
  }
}
