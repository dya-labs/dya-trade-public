CREATE TABLE IF NOT EXISTS terminal_access_records (id TEXT PRIMARY KEY, data JSONB NOT NULL);
INSERT INTO terminal_migrations (version) VALUES (3) ON CONFLICT DO NOTHING;
