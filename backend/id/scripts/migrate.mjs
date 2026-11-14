import nextEnv from '@next/env';
import { Client } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
// Intentionally never run from next build. Review the target and run explicitly.
const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString || !process.env.APP_ORIGIN) throw new Error('DATABASE_URL and APP_ORIGIN are required');
const url = new URL(process.env.APP_ORIGIN);
if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    !['http:', 'https:'].includes(url.protocol) ||
    (url.protocol !== 'https:' && url.hostname !== 'localhost')) throw new Error('APP_ORIGIN must be a valid HTTPS origin (HTTP localhost allowed)');
const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '10s'");
  await client.query('SELECT pg_advisory_xact_lock(74931001)');
  await client.query('CREATE TABLE IF NOT EXISTS terminal_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  await client.query(await readFile(new URL('../migrations/001_terminal_state.sql', import.meta.url), 'utf8'));
  await client.query('INSERT INTO terminal_state (id, origin, body) VALUES (1, $1, $2::jsonb) ON CONFLICT (id) DO NOTHING', [url.origin, JSON.stringify({ accounts: {}, sessions: {}, challenges: {}, requests: [] })]);
  const { rows } = await client.query('SELECT origin FROM terminal_state WHERE id = 1');
  if (rows[0]?.origin !== url.origin) throw new Error('Database belongs to another origin; use a separate database');
  await client.query('INSERT INTO terminal_migrations (version) VALUES (1) ON CONFLICT DO NOTHING');
  await client.query(await readFile(new URL('../migrations/002_entity_records.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('../migrations/003_access_records.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('../migrations/004_networks.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('../migrations/005_tokens.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('../migrations/006_token_images.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Migrations 001–006 applied; existing records preserved.');
} catch {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('Migration failed. Check connection, permissions, and origin binding. No credentials logged.');
  process.exitCode = 1;
} finally { await client.end().catch(() => undefined); }
