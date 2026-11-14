CREATE TABLE id_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  origin TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  requests TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(requests) AND json_type(requests) = 'array'),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  readiness TEXT NOT NULL DEFAULT 'initializing'
    CHECK (readiness IN ('initializing', 'ready'))
);

CREATE TABLE id_write_guards (
  attempt_id TEXT PRIMARY KEY,
  expected_revision INTEGER NOT NULL,
  expected_origin TEXT NOT NULL,
  expected_schema_version INTEGER NOT NULL
);

CREATE TRIGGER id_guard_revision
BEFORE INSERT ON id_write_guards
BEGIN
  SELECT (CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM id_metadata
      WHERE id = 1 AND origin = NEW.expected_origin
        AND schema_version = NEW.expected_schema_version
        AND readiness = 'ready'
    ) THEN RAISE(ABORT, 'DYA_ID_STORAGE_NOT_READY')
    WHEN NOT EXISTS (
      SELECT 1 FROM id_metadata
      WHERE id = 1 AND revision = NEW.expected_revision
    ) THEN RAISE(ABORT, 'DYA_ID_REVISION_CONFLICT')
  END);
END;

CREATE TABLE id_accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data)='object'));

CREATE TABLE id_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data)='object'));

CREATE TABLE id_challenges (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data)='object'));

CREATE TABLE id_orders (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data)='object'));

CREATE TABLE id_trades (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data)='object'));

CREATE TABLE id_deposits (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data)='object'));

CREATE TABLE id_withdrawals (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data)='object'));
CREATE INDEX id_accounts_credentialId ON id_accounts(json_extract(data, '$.credentialId'));
CREATE INDEX id_sessions_accountId ON id_sessions(json_extract(data, '$.accountId'));
CREATE INDEX id_challenges_accountId ON id_challenges(json_extract(data, '$.accountId'));
CREATE INDEX id_orders_ownerId ON id_orders(json_extract(data, '$.ownerId'));
CREATE INDEX id_trades_ownerId ON id_trades(json_extract(data, '$.ownerId'));
CREATE INDEX id_deposits_ownerId ON id_deposits(json_extract(data, '$.ownerId'));
CREATE INDEX id_withdrawals_ownerId ON id_withdrawals(json_extract(data, '$.ownerId'));
CREATE INDEX id_sessions_expires ON id_sessions(CAST(json_extract(data, '$.expires') AS INTEGER));
CREATE INDEX id_challenges_expires ON id_challenges(CAST(json_extract(data, '$.expires') AS INTEGER));
