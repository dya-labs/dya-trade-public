import type { ClickHouse } from "../clickhouse";
import { RESOLUTION_MS, type Kline, type Resolution } from "./kline";
import { bucketSql, coarsestFor } from "./intervals";
import { Semaphore } from "../api/semaphore";

export type MarketRef = { venue: string; symbol: string };

/** First stored candle per resolution (null: tier absent) and the exclusive 1m sync watermark. */
export type Coverage = { first: Record<Resolution, number | null>; syncedTo: number };

/** `caughtUp`: the market's history has been current at least once (`market_caught_up`). */
export type Market = MarketRef & { base: string; quote: string; status: string; coverage: Coverage; caughtUp: boolean };

/** One stored resolution's share of the timeline: candles with openTime in [from, to). */
export type Tier = { resolution: Resolution; from: number; to: number };

// Aliases must not shadow stored columns: ClickHouse substitutes aliases inside other expressions.
type Row = { bucket: number; o: string; h: string; l: string; c: string; v: string; qv: string; n: number; tbv: string; tbqv: string };

const COLUMNS = "open_time, open, high, low, close, volume, quote_volume, trades, taker_buy_volume, taker_buy_quote_volume";

/**
 * Which stored resolution covers which time for `interval`. 1m covers everything from its first
 * minute; for intervals of an hour or more, native 1h candles cover the time before the first
 * whole 1m hour, and for a day or more native 1d candles cover the time before the first whole
 * 1h day. Boundaries are where the coarser tier's sync stopped, so no instant is counted twice.
 */
export function tiers(coverage: Coverage, interval: string): Tier[] {
  const first1m = coverage.first["1m"];
  if (first1m === null) return [];
  const coarsest = coarsestFor(interval);
  const result: Tier[] = [{ resolution: "1m", from: first1m, to: Number.MAX_SAFE_INTEGER }];
  for (const resolution of ["1h", "1d"] as const) {
    const first = coverage.first[resolution];
    if (first === null || (resolution === "1h" ? coarsest === "1m" : coarsest !== "1d")) continue;
    const finer = result.at(-1)!;
    const boundary = Math.ceil(finer.from / RESOLUTION_MS[resolution]) * RESOLUTION_MS[resolution];
    if (first >= boundary) continue;
    finer.from = boundary;
    result.push({ resolution, from: first, to: boundary });
  }
  return result;
}

/** Earliest instant `interval` has data for, or null without history. */
export function firstFor(coverage: Coverage, interval: string): number | null {
  const covered = tiers(coverage, interval);
  return covered.length ? Math.min(...covered.map(tier => tier.from)) : null;
}

export class CandleStore {
  constructor(private readonly clickhouse: ClickHouse, private readonly queries = new Semaphore()) {}

  /**
   * Stored candles with openTime in [from, to), aggregated into `interval` buckets, ascending.
   * Open/high/low ignore zero-volume filler candles when the bucket traded at all (see foldBar).
   */
  async bars(market: MarketRef, coverage: Coverage, interval: string, anchor: number, from: number, to: number): Promise<Kline[]> {
    const parts = tiers(coverage, interval)
      .map(tier => ({ ...tier, from: Math.max(from, tier.from), to: Math.min(to, tier.to) }))
      .filter(tier => tier.from < tier.to);
    if (!parts.length) return [];
    const params: Record<string, string | number> = { venue: market.venue, symbol: market.symbol, anchor };
    const selects = parts.map((part, index) => {
      params[`from${index}`] = part.from;
      params[`to${index}`] = part.to;
      const range = `venue = {venue:String} AND symbol = {symbol:String}
        AND open_time >= fromUnixTimestamp64Milli({from${index}:Int64}, 'UTC') AND open_time < fromUnixTimestamp64Milli({to${index}:Int64}, 'UTC')`;
      return part.resolution === "1m"
        ? `SELECT ${COLUMNS} FROM klines_1m FINAL WHERE ${range}`
        : `SELECT ${COLUMNS} FROM klines_native FINAL WHERE ${range} AND resolution = '${part.resolution}'`;
    });
    const rows = await this.queries.run(() => this.clickhouse.query<Row>(
      `SELECT ${bucketSql(interval)} AS bucket, countIf(volume > 0) > 0 AS traded,
         if(traded, argMinIf(open, open_time, volume > 0), argMin(open, open_time)) AS o,
         if(traded, maxIf(high, volume > 0), max(high)) AS h,
         if(traded, minIf(low, volume > 0), min(low)) AS l,
         if(traded, argMaxIf(close, open_time, volume > 0), argMax(close, open_time)) AS c,
         sum(volume) AS v, sum(quote_volume) AS qv, sum(trades) AS n,
         sum(taker_buy_volume) AS tbv, sum(taker_buy_quote_volume) AS tbqv
       FROM (${selects.join("\nUNION ALL\n")})
       GROUP BY bucket ORDER BY bucket`,
      params,
    ));
    return rows.map(row => ({
      openTime: row.bucket, open: row.o, high: row.h, low: row.l, close: row.c,
      volume: row.v, quoteVolume: row.qv, trades: row.n, takerBuyVolume: row.tbv, takerBuyQuoteVolume: row.tbqv,
    }));
  }

  /** Sync coverage of one market. */
  async coverage(market: MarketRef): Promise<Coverage> {
    const [row] = await this.queries.run(() => this.clickhouse.query<CoverageRow>(
      `SELECT ${COVERAGE} FROM sync_state FINAL WHERE venue = {venue:String} AND symbol = {symbol:String}`,
      { venue: market.venue, symbol: market.symbol },
    ));
    return toCoverage(row);
  }

  /** Instruments with stored history, across venues. */
  async markets(): Promise<Market[]> {
    const rows = await this.queries.run(() => this.clickhouse.query<CoverageRow & MarketRef & { base: string; quote: string; status: string; caughtUp: number }>(
      `SELECT i.venue AS venue, i.symbol AS symbol, i.base AS base, i.quote AS quote, i.status AS status, s.*,
         (i.venue, i.symbol) IN (SELECT venue, symbol FROM market_caught_up) AS caughtUp
       FROM (SELECT * FROM instruments FINAL) AS i
       INNER JOIN (SELECT venue, symbol, ${COVERAGE} FROM sync_state FINAL GROUP BY venue, symbol) AS s
         ON i.venue = s.venue AND i.symbol = s.symbol
       WHERE s.first1m IS NOT NULL
       ORDER BY venue, symbol`,
    ));
    return rows.map(row => ({ venue: row.venue, symbol: row.symbol, base: row.base, quote: row.quote, status: row.status, coverage: toCoverage(row), caughtUp: Number(row.caughtUp) === 1 }));
  }
}

type CoverageRow = { first1m: number | null; first1h: number | null; first1d: number | null; syncedTo: number | null };

const COVERAGE = `anyIf(toUnixTimestamp64Milli(first_open_time), dataset = 'klines_1m') AS first1m,
  anyIf(toUnixTimestamp64Milli(first_open_time), dataset = 'klines_1h') AS first1h,
  anyIf(toUnixTimestamp64Milli(first_open_time), dataset = 'klines_1d') AS first1d,
  anyIf(toUnixTimestamp64Milli(synced_to), dataset = 'klines_1m') AS syncedTo`;

function toCoverage(row: CoverageRow | undefined): Coverage {
  return { first: { "1m": row?.first1m ?? null, "1h": row?.first1h ?? null, "1d": row?.first1d ?? null }, syncedTo: row?.syncedTo ?? 0 };
}
