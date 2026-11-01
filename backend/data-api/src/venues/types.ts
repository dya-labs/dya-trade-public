import type { ClickHouse } from "../clickhouse";
import type { Kline, Resolution } from "../candles/kline";
import type { Ticker } from "../live/protocol";
import type { Neardata } from "../near/neardata";

/** A venue spot instrument. `status` is "TRADING" when the pair is open for trading. */
export type Instrument = { symbol: string; base: string; quote: string; status: string };

/**
 * One public trade (or a venue aggregate of same-taker trades at one price).
 * `count` is the number of underlying trades; `takerBuy` is null when the venue omits the side.
 */
export type Trade = { time: number; price: string; quantity: string; count: number; takerBuy: boolean | null };

/** A page of native candles: every bar in [from, coveredTo) that the venue has, ascending. */
export type CandlePage = { klines: Kline[]; coveredTo: number };

export interface VenueRest {
  /** Spot instruments. Statuses other than "TRADING" are kept so delistings can be reported. */
  instruments(): Promise<Instrument[]>;
  /**
   * Closed native candles with openTime in [from, coveredTo), ascending, where from < coveredTo <= to.
   * `coveredTo` is the exclusive end of the range this response fully covers; the caller continues
   * from there. Minutes without trades may be absent or zero-volume fillers. A venue built from
   * our own indexed data returns no candles and `coveredTo === from` while nothing past `from` is
   * settled yet; the caller retries on its next pass.
   */
  candles(symbol: string, resolution: Resolution, from: number, to: number): Promise<CandlePage>;
  /**
   * Oldest openTime the venue serves at `resolution`: the first candle for venues with full history,
   * or the retention limit for venues that keep a rolling window. Null when the venue has none.
   */
  earliest(symbol: string, resolution: Resolution): Promise<number | null>;
  /**
   * Native candles for parity checks (`verify`), for intervals listed in `Venue.parityIntervals`,
   * openTime in [from, to), ascending, at most 1000.
   */
  nativeCandles(symbol: string, interval: string, from: number, to: number): Promise<Kline[]>;
}

export type LiveSink = {
  /** Trades of one symbol, in venue order. */
  trade(symbol: string, trade: Trade): void;
  /** Rolling 24h ticker; the ingest throttles publication to about one per second per symbol. */
  ticker(ticker: Ticker): void;
  /** Connection state; false while reconnecting. */
  connected(connected: boolean): void;
  /** A venue message that failed validation; logged, never fatal. */
  invalid(detail: string): void;
};

export interface VenueLive {
  /** Streams trades and tickers for `symbols` until closed, reconnecting on its own. */
  open(symbols: readonly string[], sink: LiveSink): { close(): void };
}

/** `budget`: REST requests per minute (Binance: request weight per minute). `streamUrl` is empty for venues read from the NEAR block feed. */
export type VenueOptions = { restUrl: string; streamUrl: string; budget: number };

/**
 * Our own stores, for venues built from data we index (Rhea, NEAR Intents), and their
 * credentials: the Intents Explorer key for the Intents backfill, neardata (with the FastNEAR key)
 * for NEAR block repair. Exchange venues ignore it.
 */
export type VenueContext = { clickhouse: ClickHouse; redisUrl: string; intentsExplorerJwt: string | undefined; neardata: Neardata };

export type Venue = {
  id: string;
  label: string;
  /** CoinGecko exchange identifier used for reviewed market discovery. */
  coinGeckoId: string;
  /** Resolutions synced from REST, finest first. Full-history venues sync only "1m". */
  history: readonly Resolution[];
  /** Whether REST candles carry quote volumes, trade counts and taker-buy volumes; live bars zero what REST lacks. */
  fields: { quoteVolume: boolean; trades: boolean; takerBuy: boolean };
  /** Our interval names whose native candles share our bucket grid, for `verify`. */
  parityIntervals: readonly string[];
  /** How far stored history may trail the live edge and still count as current; MAX_SYNC_LAG_MS when absent. */
  maxSyncLagMs?: number;
  defaults: VenueOptions;
  /** Venue symbol for a base/quote pair, as used in REST and stored in ClickHouse. */
  symbol(base: string, quote: string): string;
  rest(options: VenueOptions, context: VenueContext): VenueRest;
  live(options: VenueOptions, rest: VenueRest, context: VenueContext): VenueLive;
};
