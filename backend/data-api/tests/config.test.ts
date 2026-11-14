import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

test("ClickHouse file secret removes only its terminal newline", () => {
  const directory = mkdtempSync(join(tmpdir(), "data-api-config-"));
  directories.push(directory);
  const path = join(directory, "password");
  writeFileSync(path, "  significant whitespace  \r\n", { mode: 0o600 });
  expect(loadConfig({ CLICKHOUSE_PASSWORD_FILE: path }).clickhouse.password).toBe("  significant whitespace  ");
});

test("ambiguous and unreadable secret configuration fails closed", () => {
  expect(() => loadConfig({ CLICKHOUSE_PASSWORD: "inline", CLICKHOUSE_PASSWORD_FILE: "/missing" })).toThrow("Set only one");
  expect(() => loadConfig({ CLICKHOUSE_PASSWORD_FILE: "/missing/data-api-secret" })).toThrow();
  expect(loadConfig({ CLICKHOUSE_PASSWORD: "inline" }).clickhouse.password).toBe("inline");
});
