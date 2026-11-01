-- Prices widen to 18 fraction digits: some venue pairs trade below 1e-8 (MOG ~1e-7, others lower).
-- Volumes keep 8. On non-replicated MergeTree this ALTER waits for the column rewrite
-- (measured locally: 6.2M rows in 12.5 s); stored values are unchanged.
ALTER TABLE klines_1m
    MODIFY COLUMN open Decimal(38, 18) CODEC(ZSTD(1)),
    MODIFY COLUMN high Decimal(38, 18) CODEC(ZSTD(1)),
    MODIFY COLUMN low Decimal(38, 18) CODEC(ZSTD(1)),
    MODIFY COLUMN close Decimal(38, 18) CODEC(ZSTD(1));

-- Native 1h/1d candles for venues whose 1m retention is short (Gate keeps ~7 days of 1m).
-- Only the range before the market's first stored 1m (1h) or first stored 1h (1d) is synced,
-- so every instant is covered by exactly one resolution.
CREATE TABLE IF NOT EXISTS klines_native
(
    venue LowCardinality(String),
    symbol LowCardinality(String),
    resolution LowCardinality(String),
    open_time DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    open Decimal(38, 18) CODEC(ZSTD(1)),
    high Decimal(38, 18) CODEC(ZSTD(1)),
    low Decimal(38, 18) CODEC(ZSTD(1)),
    close Decimal(38, 18) CODEC(ZSTD(1)),
    volume Decimal(38, 8) CODEC(ZSTD(1)),
    quote_volume Decimal(38, 8) CODEC(ZSTD(1)),
    trades UInt32 CODEC(T64, ZSTD(1)),
    taker_buy_volume Decimal(38, 8) CODEC(ZSTD(1)),
    taker_buy_quote_volume Decimal(38, 8) CODEC(ZSTD(1)),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3) CODEC(DoubleDelta, ZSTD(1))
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (venue, symbol, resolution, open_time);
