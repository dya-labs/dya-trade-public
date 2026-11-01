-- Canonical 1-minute candles. Every other interval is aggregated from this table,
-- so there is exactly one copy of each minute. Duplicate inserts (re-syncs, WS/REST overlap)
-- collapse by (venue, symbol, open_time); reads use FINAL.
CREATE TABLE IF NOT EXISTS klines_1m
(
    venue LowCardinality(String),
    symbol LowCardinality(String),
    open_time DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    open Decimal(38, 8) CODEC(ZSTD(1)),
    high Decimal(38, 8) CODEC(ZSTD(1)),
    low Decimal(38, 8) CODEC(ZSTD(1)),
    close Decimal(38, 8) CODEC(ZSTD(1)),
    volume Decimal(38, 8) CODEC(ZSTD(1)),
    quote_volume Decimal(38, 8) CODEC(ZSTD(1)),
    trades UInt32 CODEC(T64, ZSTD(1)),
    taker_buy_volume Decimal(38, 8) CODEC(ZSTD(1)),
    taker_buy_quote_volume Decimal(38, 8) CODEC(ZSTD(1)),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3) CODEC(DoubleDelta, ZSTD(1))
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(open_time)
ORDER BY (venue, symbol, open_time);

-- Venue instrument metadata, refreshed from the venue's exchange information.
CREATE TABLE IF NOT EXISTS instruments
(
    venue LowCardinality(String),
    symbol String,
    base String,
    quote String,
    status LowCardinality(String),
    updated_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (venue, symbol);

-- REST sync progress. synced_to is exclusive: every closed minute before it was requested
-- from the source, so gaps after it are "not yet synced" rather than venue outages.
-- first_open_time is the venue's first minute for the symbol (anchors 3d candles).
CREATE TABLE IF NOT EXISTS sync_state
(
    venue LowCardinality(String),
    symbol String,
    dataset LowCardinality(String),
    first_open_time Nullable(DateTime64(3, 'UTC')),
    synced_to DateTime64(3, 'UTC'),
    updated_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (venue, symbol, dataset);
