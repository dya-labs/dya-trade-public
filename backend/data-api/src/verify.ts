import { decimal, units } from "./candles/bar";
import { anchorFor, bucketStart, shiftBuckets } from "./candles/intervals";
import type { Kline } from "./candles/kline";
import { firstFor, type CandleStore, type MarketRef } from "./candles/store";
import type { Venue, VenueRest } from "./venues/types";

export type ParityReport = {
  interval: string; from: string; bars: number; mismatched: number; missingHere: number; missingAtVenue: number;
  /** Largest |ours − venue| quote volume; venues round quote volume per candle, so it is reported, not matched. */
  maxQuoteVolumeDiff: string;
  firstMismatch?: object;
};

const EXACT = ["open", "high", "low", "close", "volume"] as const;

/**
 * Compares our aggregated bars with the venue's native candles over the latest `count` buckets
 * that ClickHouse fully covers. Prices and base volume compare exactly; trade counts too where
 * both sides carry them. Taker volumes are not compared (several venues' native candles lack them).
 */
export async function verifyParity(venue: Venue, rest: VenueRest, store: CandleStore, market: MarketRef, intervals: readonly string[], count = 1000): Promise<ParityReport[]> {
  const coverage = await store.coverage(market);
  const earliest = firstFor(coverage, "1M");
  if (earliest === null) throw new Error(`No stored history for ${market.venue}:${market.symbol}`);
  const reports: ParityReport[] = [];
  for (const interval of intervals) {
    if (!venue.parityIntervals.includes(interval)) throw new Error(`${venue.id} has no native ${interval} candles on our grid`);
    const anchor = anchorFor(interval, earliest);
    const end = bucketStart(interval, Math.min(Date.now(), coverage.syncedTo), anchor);
    // The bucket holding the interval's first stored candle may be partial (e.g. a 15m bucket whose first minutes aged out at the venue).
    const first = firstFor(coverage, interval)!, firstBucket = bucketStart(interval, first, anchor);
    const from = Math.max(shiftBuckets(interval, end, -count), firstBucket === first ? first : shiftBuckets(interval, firstBucket, 1));
    const [native, ours] = await Promise.all([rest.nativeCandles(market.symbol, interval, from, end), store.bars(market, coverage, interval, anchor, from, end)]);
    const byTime = new Map(ours.map(bar => [bar.openTime, bar]));
    const report: ParityReport = { interval, from: new Date(from).toISOString(), bars: native.length, mismatched: 0, missingHere: 0, missingAtVenue: 0, maxQuoteVolumeDiff: "0" };
    let maxQuote = 0n;
    for (const venueBar of native) {
      const bar = byTime.get(venueBar.openTime);
      byTime.delete(venueBar.openTime);
      // Venues that emit zero-volume fillers have no stored counterpart when we stored none either.
      if (!bar) { if (units(venueBar.volume) > 0n) report.missingHere++; continue; }
      const differing: (keyof Kline)[] = EXACT.filter(field => units(bar[field]) !== units(venueBar[field]));
      if (bar.trades && venueBar.trades && bar.trades !== venueBar.trades) differing.push("trades");
      const quote = units(bar.quoteVolume) - units(venueBar.quoteVolume);
      if ((quote < 0n ? -quote : quote) > maxQuote) maxQuote = quote < 0n ? -quote : quote;
      if (!differing.length) continue;
      report.mismatched++;
      report.firstMismatch ??= {
        openTime: new Date(venueBar.openTime).toISOString(),
        ours: Object.fromEntries(differing.map(field => [field, bar[field]])),
        venue: Object.fromEntries(differing.map(field => [field, venueBar[field]])),
      };
    }
    // Some venues serve only a recent window (Kraken: 720 candles); compare inside what they returned.
    const [nativeFirst, nativeLast] = [native[0]?.openTime ?? Infinity, native.at(-1)?.openTime ?? -Infinity];
    report.missingAtVenue = [...byTime.values()].filter(bar => bar.openTime >= nativeFirst && bar.openTime <= nativeLast && units(bar.volume) > 0n).length;
    report.maxQuoteVolumeDiff = decimal(maxQuote);
    reports.push(report);
  }
  return reports;
}
