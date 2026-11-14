-- Run during a maintenance window before deploying the matching application.
-- Migration and copy are atomic; retain terminal_state as the pre-cutover snapshot.
CREATE TABLE IF NOT EXISTS terminal_metadata (
  id integer PRIMARY KEY CHECK (id = 1), origin text NOT NULL,
  requests jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS terminal_accounts (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  owner_id text GENERATED ALWAYS AS (id) STORED
);
CREATE INDEX IF NOT EXISTS terminal_accounts_owner_idx ON terminal_accounts (owner_id);
CREATE TABLE IF NOT EXISTS terminal_sessions (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  owner_id text GENERATED ALWAYS AS ((data->>'accountId')) STORED
);
CREATE INDEX IF NOT EXISTS terminal_sessions_owner_idx ON terminal_sessions (owner_id);
CREATE INDEX IF NOT EXISTS terminal_sessions_expiry_idx ON terminal_sessions (((data->>'expires')::bigint));
CREATE TABLE IF NOT EXISTS terminal_challenges (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  owner_id text GENERATED ALWAYS AS ((data->>'accountId')) STORED
);
CREATE INDEX IF NOT EXISTS terminal_challenges_owner_idx ON terminal_challenges (owner_id);
CREATE INDEX IF NOT EXISTS terminal_challenges_expiry_idx ON terminal_challenges (((data->>'expires')::bigint));
CREATE TABLE IF NOT EXISTS terminal_orders (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  owner_id text GENERATED ALWAYS AS ((data->>'ownerId')) STORED
);
CREATE INDEX IF NOT EXISTS terminal_orders_owner_idx ON terminal_orders (owner_id);
CREATE TABLE IF NOT EXISTS terminal_trades (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  owner_id text GENERATED ALWAYS AS ((data->>'ownerId')) STORED
);
CREATE INDEX IF NOT EXISTS terminal_trades_owner_idx ON terminal_trades (owner_id);
CREATE TABLE IF NOT EXISTS terminal_deposits (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  owner_id text GENERATED ALWAYS AS ((data->>'ownerId')) STORED
);
CREATE INDEX IF NOT EXISTS terminal_deposits_owner_idx ON terminal_deposits (owner_id);
CREATE TABLE IF NOT EXISTS terminal_withdrawals (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  owner_id text GENERATED ALWAYS AS ((data->>'ownerId')) STORED
);
CREATE INDEX IF NOT EXISTS terminal_withdrawals_owner_idx ON terminal_withdrawals (owner_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM terminal_migrations WHERE version = 2) THEN
    PERFORM id FROM terminal_state WHERE id = 1 FOR UPDATE;
    INSERT INTO terminal_metadata (id, origin, requests)
      SELECT id, origin, COALESCE(body->'requests', '[]'::jsonb) FROM terminal_state;
    INSERT INTO terminal_accounts (id, data) SELECT entry.key, entry.value FROM terminal_state, jsonb_each(COALESCE(body->'accounts', '{}'::jsonb)) entry;
    INSERT INTO terminal_sessions (id, data) SELECT entry.key, entry.value FROM terminal_state, jsonb_each(COALESCE(body->'sessions', '{}'::jsonb)) entry;
    INSERT INTO terminal_challenges (id, data) SELECT entry.key, entry.value FROM terminal_state, jsonb_each(COALESCE(body->'challenges', '{}'::jsonb)) entry;
    INSERT INTO terminal_orders (id, data) SELECT entry.key, entry.value FROM terminal_state, jsonb_each(COALESCE(body->'liveOrders', '{}'::jsonb)) entry;
    INSERT INTO terminal_trades (id, data) SELECT entry.key, entry.value FROM terminal_state, jsonb_each(COALESCE(body->'liveTrades', '{}'::jsonb)) entry;
    INSERT INTO terminal_deposits (id, data) SELECT entry.key, entry.value FROM terminal_state, jsonb_each(COALESCE(body->'deposits', '{}'::jsonb)) entry;
    INSERT INTO terminal_withdrawals (id, data) SELECT entry.key, entry.value FROM terminal_state, jsonb_each(COALESCE(body->'withdrawals', '{}'::jsonb)) entry;
    INSERT INTO terminal_migrations (version) VALUES (2);
  END IF;
END $$;
-- Older instances must fail closed rather than silently write the obsolete snapshot.
CREATE OR REPLACE FUNCTION reject_legacy_terminal_write() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Legacy terminal storage is read-only after migration 002';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS terminal_legacy_read_only ON terminal_state;
CREATE TRIGGER terminal_legacy_read_only BEFORE UPDATE OR DELETE ON terminal_state
FOR EACH ROW EXECUTE FUNCTION reject_legacy_terminal_write();
