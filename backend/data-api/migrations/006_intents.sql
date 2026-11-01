-- Every `token_diff` intent the NEAR Intents verifier (intents.near) executed in successful
-- receipts: users' swaps and solvers' legs alike, one row per intent. Amounts are the raw signed
-- token integers of `diff` (negative: given) and the protocol fees collected per token. Trades
-- are derived from these rows on read. A replayed block or backfilled transaction converges on
-- the same key.
CREATE TABLE IF NOT EXISTS intents_diffs
(
    block_time DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    receipt_id String CODEC(ZSTD(1)),
    -- Position among the receipt's token_diff logs, and of the intent within that log's data.
    log_index UInt16,
    item UInt16,
    block_height UInt64 CODEC(DoubleDelta, ZSTD(1)),
    tx_hash String CODEC(ZSTD(1)),
    intent_hash String CODEC(ZSTD(1)),
    account_id String CODEC(ZSTD(1)),
    -- Set by 1Click on its users' intents (`1click-<partner>`; `referral` before mid-2025); empty for solvers.
    referral LowCardinality(String),
    tokens Array(LowCardinality(String)),
    amounts Array(Int256) CODEC(ZSTD(1)),
    fee_tokens Array(LowCardinality(String)),
    fees Array(UInt256) CODEC(ZSTD(1)),
    version LowCardinality(String),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3) CODEC(DoubleDelta, ZSTD(1))
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(block_time)
ORDER BY (block_time, receipt_id, log_index, item);

-- Indexer progress: `cursor` is the last block whose intents are all stored; `switch` is the
-- first whole minute the live indexer covers; `backfill` is the oldest Explorer creation time
-- whose 1Click swaps' transactions are all stored (walking back from the switch).
CREATE TABLE IF NOT EXISTS intents_state
(
    key LowCardinality(String),
    height UInt64,
    time DateTime64(3, 'UTC'),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY key;

-- 1Click swaps the backfill couldn't recover: the Explorer listed them as successful, but none of
-- their NEAR transactions held their intents. Coverage reports them per day.
CREATE TABLE IF NOT EXISTS intents_gaps
(
    created_at DateTime64(3, 'UTC'),
    deposit_address String,
    intent_hashes Array(String),
    origin_asset LowCardinality(String),
    destination_asset LowCardinality(String),
    reason LowCardinality(String),
    recorded_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(recorded_at)
ORDER BY (created_at, deposit_address);

-- Hourly derivation outcome of stored intents, served by the coverage endpoint: receipts by status
-- (route, fallback, no-user, bridge, unknown-asset) with their charted trades and the trades whose
-- other side has no USD source.
CREATE TABLE IF NOT EXISTS intents_coverage
(
    hour DateTime64(3, 'UTC'),
    status LowCardinality(String),
    receipts UInt32,
    trades UInt32,
    unpriced UInt32,
    computed_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(computed_at)
ORDER BY (hour, status);
