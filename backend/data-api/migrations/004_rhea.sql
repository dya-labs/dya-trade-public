-- Every swap on Rhea's classic (v2.ref-finance.near) and concentrated-liquidity
-- (dclv2.ref-labs.near) contracts from successful receipts, one row per hop. Amounts are the
-- raw token integers from the logs. A replayed block converges on the same key.
CREATE TABLE IF NOT EXISTS rhea_swaps
(
    token_in LowCardinality(String),
    token_out LowCardinality(String),
    block_time DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    receipt_id String CODEC(ZSTD(1)),
    -- Position among the receipt's swap logs (DCL: event * 100 + item).
    log_index UInt32,
    block_height UInt64 CODEC(DoubleDelta, ZSTD(1)),
    tx_hash String CODEC(ZSTD(1)),
    contract LowCardinality(String),
    -- DCL pool id; empty for classic pools, whose logs do not name the pool.
    pool_id String CODEC(ZSTD(1)),
    amount_in UInt256 CODEC(ZSTD(1)),
    amount_out UInt256 CODEC(ZSTD(1)),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3) CODEC(DoubleDelta, ZSTD(1))
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(block_time)
ORDER BY (token_in, token_out, block_time, receipt_id, log_index);

-- Indexer progress: `cursor` is the last block whose swaps are all stored; `switch` is the
-- first whole minute the live indexer covers; Rhea candles start there.
CREATE TABLE IF NOT EXISTS rhea_state
(
    key LowCardinality(String),
    height UInt64,
    time DateTime64(3, 'UTC'),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY key;
