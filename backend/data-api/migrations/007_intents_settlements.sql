-- 1Click swaps settled by `transfer` intents through 1Click's settlement account instead of
-- token_diff intents (most swaps since late October 2026): one row per Explorer swap (deposit
-- address and quote creation time), the deposit account's net exchange with the settler across
-- the swap's verifier transfers, stored once its payout is on chain and again when it succeeds.
-- `amount_in` is the Explorer's swapped input (raw origin units), `amount_out` what the settler
-- paid (raw destination units); the partner (app) fee is kept off-chain, so it is recorded here
-- and taken off the input on read. The time is the block of the settler's (last) payout.
CREATE TABLE IF NOT EXISTS intents_settlements
(
    created_at DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    deposit_address String CODEC(ZSTD(1)),
    block_time DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    block_height UInt64 CODEC(DoubleDelta, ZSTD(1)),
    tx_hash String CODEC(ZSTD(1)),
    account_id String CODEC(ZSTD(1)),
    settler_id LowCardinality(String),
    origin_asset LowCardinality(String),
    amount_in UInt256 CODEC(ZSTD(1)),
    destination_asset LowCardinality(String),
    amount_out UInt256 CODEC(ZSTD(1)),
    app_fee_bps UInt16,
    referral LowCardinality(String),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3) CODEC(DoubleDelta, ZSTD(1)),
    INDEX block_time_range block_time TYPE minmax GRANULARITY 1
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (created_at, deposit_address);

-- `intents_state` gains two keys: `settlements`, before which every settled swap's payout is
-- stored (live), and `settlements_history`, the oldest Explorer creation time whose settled swaps
-- are all stored (walking back to the switch minute).
