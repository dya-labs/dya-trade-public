import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ClickHouse } from "./clickhouse";
import { log as logEvent } from "./log";

const directory = join(import.meta.dir, "..", "migrations");

/**
 * Applies migrations/NNN_*.sql in order, once each. ClickHouse DDL is not transactional,
 * so statements must stay idempotent (IF NOT EXISTS) to allow re-running a partial file.
 */
export async function migrate(clickhouse: ClickHouse, log: (database: string, file: string) => void = (database, file) => logEvent("migrate.applied", { database, file })): Promise<string[]> {
  const database = clickhouse.options.database;
  await clickhouse.command(`CREATE DATABASE IF NOT EXISTS ${database}`, {}, "default");
  await clickhouse.command("CREATE TABLE IF NOT EXISTS schema_migrations (name String, applied_at DateTime64(3, 'UTC') DEFAULT now64(3)) ENGINE = MergeTree ORDER BY name");
  const applied = new Set((await clickhouse.query<{ name: string }>("SELECT name FROM schema_migrations")).map(row => row.name));
  const files = (await readdir(directory)).filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file)).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await Bun.file(join(directory, file)).text();
    const statements = sql.replace(/^\s*--.*$/gm, "").split(/;\s*$/m).map(statement => statement.trim()).filter(Boolean);
    for (const statement of statements) await clickhouse.command(statement, {}, undefined, 3_600_000);
    await clickhouse.insert("schema_migrations", [{ name: file }]);
    log(database, file);
    ran.push(file);
  }
  return ran;
}
