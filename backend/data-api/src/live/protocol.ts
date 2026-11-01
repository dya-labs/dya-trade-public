import type { Kline } from "../candles/kline";

/**
 * Redis contract between the single ingest process and any number of API processes.
 * Everything here is ephemeral and rebuilt from the venue within minutes; ClickHouse is the
 * durable store. Redis may be flushed or restarted at any time.
 */
export function liveKeys(venue: string) {
  return {
    /** Hash per symbol: openTime -> Kline JSON for recent minutes not yet guaranteed in ClickHouse. */
    recent: (symbol: string) => `md:${venue}:recent:${symbol}`,
    /** Pub/sub channel of KlineEvent JSON for every stream update. */
    klines: `md:${venue}:klines`,
    /** Hash: symbol -> Ticker JSON. */
    tickers: `md:${venue}:tickers`,
    /** Pub/sub channel of Ticker JSON. */
    tickerUpdates: `md:${venue}:tickers:updates`,
    /** IngestStatus JSON with a short expiry; absence means the ingestor is down. */
    status: `md:${venue}:ingest`,
  };
}

/** Start time of the API's main process (workers are its children); a change means it restarted. */
export const API_STARTED_KEY = "md:api:started";

/** How long recent minutes stay in Redis; must exceed the REST sync lag to ClickHouse. */
export const RECENT_RETENTION_MS = 15 * 60_000;

/**
 * A market's stored history counts as current within this of the live edge (REST sync runs every
 * minute), unless its venue sets `maxSyncLagMs`. /healthz reports a venue behind past it; a market
 * is first listed once inside it.
 */
export const MAX_SYNC_LAG_MS = 5 * 60_000;

export type KlineEvent = { symbol: string; closed: boolean; kline: Kline };

export type Ticker = {
  symbol: string;
  lastPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  /** Rolling 24h change, (last - open) / open * 100, as Binance computes priceChangePercent. */
  changePercent: number;
  eventTime: number;
};

export type IngestStatus = {
  at: number;
  /** Process start; a change means the ingest process restarted. */
  startedAt: number;
  connected: boolean;
  lastEventAt: number | null;
  /** Exclusive ClickHouse watermark per symbol. */
  syncedTo: Record<string, number>;
  errors: Record<string, string>;
};
