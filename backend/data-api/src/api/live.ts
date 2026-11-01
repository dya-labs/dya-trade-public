import type { Kline } from "../candles/kline";
import type { MarketRef } from "../candles/store";
import { foldBar, wireBar, type WireBar } from "../candles/bar";
import { bucketStart, shiftBuckets } from "../candles/intervals";
import type { KlineEvent } from "../live/protocol";
import { log } from "../log";
import type { BarReader } from "./bars";

// Re-read the bucket from ClickHouse + Redis periodically to repair missed stream updates.
const RESEED_MS = 5_000;

export type LiveMarket = MarketRef & { id: string };

type Fold = {
  market: LiveMarket;
  interval: string;
  anchor: number;
  start: number;
  seed: Kline | undefined;
  cutoff: number;
  minutes: Map<number, Kline>;
  /** Events received while a reseed is in flight; replayed (idempotently) onto the result. */
  pending: Kline[] | undefined;
  ready: Promise<void>;
  /** False until the first seed lands; unseeded bars lack the ClickHouse prefix and are not published. */
  seeded: boolean;
  last: string;
  reseededAt: number;
  closed: Map<number, string>;
  closedThrough: number;
};

/**
 * Maintains the current bar of every (market, interval) that has subscribers by folding the
 * 1m stream into the bucket: minutes are keyed by open time, so repeated or reordered updates
 * of the same minute converge to the latest value.
 */
export class LiveBars {
  private readonly folds = new Map<string, Fold>();

  constructor(private readonly reader: BarReader, private readonly emit: (market: string, interval: string, bar: WireBar, closed?: boolean) => void) {}

  /** Starts folding (idempotent) and resolves with the current bar, if the bucket has data. */
  async open(market: LiveMarket, interval: string, anchor: number): Promise<WireBar | undefined> {
    const key = `${market.id}:${interval}`;
    let fold = this.folds.get(key);
    if (!fold) {
      const start = bucketStart(interval, Date.now(), anchor);
      const created: Fold = { market, interval, anchor, start, seed: undefined, cutoff: start, minutes: new Map(), pending: undefined, ready: Promise.resolve(), seeded: false, last: "", reseededAt: 0, closed: new Map(), closedThrough: -1 };
      created.ready = this.reseed(created).catch(error => {
        if (this.folds.get(key) === created) this.folds.delete(key);
        throw error;
      });
      this.folds.set(key, created);
      fold = created;
    }
    await fold.ready;
    const bar = this.bar(fold);
    return bar && wireBar(bar);
  }

  close(market: string, interval: string): void {
    this.folds.delete(`${market}:${interval}`);
  }

  onKline(venue: string, event: KlineEvent): void {
    for (const fold of this.folds.values()) {
      if (fold.market.venue !== venue || fold.market.symbol !== event.symbol) continue;
      fold.pending?.push(event.kline);
      this.apply(fold, event.kline);
      if (fold.seeded) this.publish(fold);
      if (event.closed && event.kline.openTime + 60_000 >= shiftBuckets(fold.interval, fold.start, 1)) this.publishClosed(fold);
    }
  }

  /** Periodic repair; call on a timer. */
  async reseedStale(): Promise<void> {
    const now = Date.now();
    for (const fold of [...this.folds.values()]) {
      if (fold.pending || now - fold.reseededAt < RESEED_MS) continue;
      for (const [start, previous] of fold.closed) {
        const result = await this.reader.read(fold.market, fold.interval, fold.anchor, start, shiftBuckets(fold.interval, start, 1));
        if (!result.final) continue;
        const bar = result.bars[0];
        if (bar && JSON.stringify(wireBar(bar)) !== previous) this.emit(fold.market.id, fold.interval, wireBar(bar), true);
        fold.closed.delete(start);
      }
      fold.ready = this.reseed(fold);
      await fold.ready.catch(error => log("api.live.reseed", { error: String(error) }, "error"));
    }
  }

  private apply(fold: Fold, kline: Kline): void {
    const start = bucketStart(fold.interval, kline.openTime, fold.anchor);
    if (start > fold.start) {
      if (fold.seeded) this.publishClosed(fold);
      fold.start = start;
      fold.seed = undefined;
      fold.cutoff = start;
      fold.minutes.clear();
    }
    if (start === fold.start && kline.openTime >= fold.cutoff) fold.minutes.set(kline.openTime, kline);
  }

  private bar(fold: Fold): Kline | undefined {
    return foldBar(fold.start, fold.seed, [...fold.minutes.values()].sort((a, b) => a.openTime - b.openTime));
  }

  private publishClosed(fold: Fold): void {
    const bar = this.bar(fold);
    if (!bar || fold.start <= fold.closedThrough) return;
    const wire = wireBar(bar);
    fold.closed.set(fold.start, JSON.stringify(wire));
    fold.closedThrough = fold.start;
    this.emit(fold.market.id, fold.interval, wire, true);
  }

  private publish(fold: Fold): void {
    const bar = this.bar(fold);
    if (!bar) return;
    const wire = wireBar(bar);
    const json = JSON.stringify(wire);
    if (json === fold.last) return;
    fold.last = json;
    this.emit(fold.market.id, fold.interval, wire);
  }

  private async reseed(fold: Fold): Promise<void> {
    const pending: Kline[] = [];
    fold.pending = pending;
    try {
      if (fold.seeded && bucketStart(fold.interval, Date.now(), fold.anchor) > fold.start) this.publishClosed(fold);
      const tail = await this.reader.tail(fold.market, fold.interval, fold.anchor, bucketStart(fold.interval, Date.now(), fold.anchor));
      fold.start = tail.start;
      fold.seed = tail.seed;
      fold.cutoff = tail.cutoff;
      fold.minutes = new Map(tail.minutes.map(kline => [kline.openTime, kline]));
      fold.reseededAt = Date.now();
      for (const kline of pending) this.apply(fold, kline);
    } finally {
      fold.pending = undefined;
    }
    // The first seed is delivered by open() to its caller; later repairs go to all subscribers.
    if (fold.seeded) return this.publish(fold);
    fold.seeded = true;
    const bar = this.bar(fold);
    fold.last = bar ? JSON.stringify(wireBar(bar)) : "";
  }
}
