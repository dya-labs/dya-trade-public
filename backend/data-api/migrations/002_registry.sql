CREATE TABLE IF NOT EXISTS registry_assets (
  asset_id String,
  symbol String,
  chain String,
  contract Nullable(String),
  coingecko_id Nullable(String),
  aliases Array(String),
  unavailable_reason Nullable(String),
  revision String,
  updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (revision, asset_id);

CREATE TABLE IF NOT EXISTS registry_sources (
  asset_id String,
  market_id String,
  venue LowCardinality(String),
  symbol String,
  base String,
  quote LowCardinality(String),
  rank UInt16,
  valid_from DateTime64(3, 'UTC'),
  valid_to Nullable(DateTime64(3, 'UTC')),
  coingecko_ticker_url String,
  continuation_evidence Nullable(String),
  continuation_of Nullable(String),
  conversion_ratio Decimal(38, 18),
  revision String,
  updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (revision, asset_id, market_id, valid_from);
