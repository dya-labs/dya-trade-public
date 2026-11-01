-- When each market's stored 1m history first came within the sync-lag threshold of the live
-- edge. The API lists a market only after that, so a first backfill's last day is never served
-- (or alerted on) as a lagging market; a market that falls behind later stays listed.
CREATE TABLE IF NOT EXISTS market_caught_up
(
    venue LowCardinality(String),
    symbol LowCardinality(String),
    caught_up_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree
ORDER BY (venue, symbol);

-- Markets that are current at migration time count as caught up, so the API keeps listing them.
INSERT INTO market_caught_up (venue, symbol, caught_up_at)
SELECT venue, symbol, synced_to FROM sync_state FINAL
WHERE dataset = 'klines_1m' AND synced_to >= now64(3) - INTERVAL 15 MINUTE;
