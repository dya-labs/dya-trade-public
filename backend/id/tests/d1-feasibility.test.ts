import { afterAll, beforeAll, expect, test } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";

// Uses real workerd D1, not node:sqlite or a mock implementation.
let mf: Miniflare;
let db: Awaited<ReturnType<Miniflare["getD1Database"]>>;
beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "id-test", modules: true, script: `import { env } from 'cloudflare:workers'; export default { async fetch() { return Response.json(await env.DYA_ID_DB.prepare('SELECT origin FROM id_metadata').all()); } };`, compatibilityDate: "2026-10-02", d1Databases: { DYA_ID_DB: "feasibility" } }] }));
  db = await mf.getD1Database("DYA_ID_DB");
  const schema = await readFile(new URL("fixtures/feasibility.sql", import.meta.url), "utf8");
  // D1 exec splits on newlines; preserve the trigger as one statement.
  for (const statement of schema.match(/CREATE TRIGGER[\s\S]*?\nEND;|CREATE (?:TABLE|INDEX)[^;]+;/g) ?? []) await db.prepare(statement.trim()).run();
  await db.prepare("INSERT INTO id_metadata(id,origin,schema_version,readiness) VALUES(1,?,1,'ready')").bind("http://localhost:3101").run();
});
afterAll(async () => { await mf?.dispose(); });
const guard = (id: string, revision: number) => db.prepare("INSERT INTO id_write_guards VALUES(?,?,?,?)").bind(id, revision, "http://localhost:3101", 1);

test("prepared_binding_json_indexes_and_worker_env", async () => {
  const value = JSON.stringify({ id: "bound' ?", credentialId: "credential", counter: 0 });
  await db.prepare("INSERT INTO id_accounts VALUES(?,?)").bind("bound' ?", value).run();
  expect(await db.prepare("SELECT data FROM id_accounts WHERE json_extract(data,'$.credentialId')=?").bind("credential").first("data")).toBe(value);
  const result = await mf.dispatchFetch("http://localhost/");
  expect((await result.json() as { results: unknown[] }).results).toEqual([{ origin: "http://localhost:3101" }]);
  await expect(db.prepare("INSERT INTO id_accounts VALUES(?,?)").bind("bad", "[]").run()).rejects.toThrow(/CHECK/);
});
test("guard_success_and_exact_conflict_rolls_back_entire_batch", async () => {
  await db.batch([guard("ok", 0), db.prepare("UPDATE id_metadata SET revision=revision+1"), db.prepare("DELETE FROM id_write_guards WHERE attempt_id=?").bind("ok")]);
  await expect(db.batch([db.prepare("INSERT INTO id_accounts VALUES(?,?)").bind("rollback", '{}'), guard("stale", 0)])).rejects.toThrow(/^D1_ERROR: DYA_ID_REVISION_CONFLICT(?:: SQLITE_CONSTRAINT(?:_TRIGGER)?(?: \(extended: SQLITE_CONSTRAINT_TRIGGER\))?|: SQLITE_ERROR)?$/);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM id_accounts WHERE id='rollback'").first("n")).toBe(0);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM id_write_guards").first("n")).toBe(0);
  expect(await db.prepare("SELECT revision FROM id_metadata").first("revision")).toBe(1);
});
test("constraint_failure_rolls_back_guard_entity_and_metadata", async () => {
  await expect(db.batch([guard("constraint", 1), db.prepare("INSERT INTO id_accounts VALUES('partial','{}')"), db.prepare("UPDATE id_metadata SET revision=revision+1"), db.prepare("INSERT INTO id_accounts VALUES('invalid','not-json')")])).rejects.toThrow(/CHECK/);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM id_accounts WHERE id='partial'").first("n")).toBe(0);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM id_write_guards").first("n")).toBe(0);
  expect(await db.prepare("SELECT revision FROM id_metadata").first("revision")).toBe(1);
});
test("read_batches_observe_consistent_revision_and_entity_snapshot", async () => {
  await db.prepare("INSERT INTO id_accounts VALUES('snapshot',?)").bind(JSON.stringify({ revision: 1 })).run();
  const writes = Array.from({ length: 20 }, (_, i) => db.batch([
    db.prepare("UPDATE id_metadata SET revision=?").bind(i + 2),
    db.prepare("UPDATE id_accounts SET data=? WHERE id='snapshot'").bind(JSON.stringify({ revision: i + 2 })),
  ]));
  const reads = Array.from({ length: 20 }, () => db.batch([db.prepare("SELECT revision FROM id_metadata"), db.prepare("SELECT json_extract(data,'$.revision') AS revision FROM id_accounts WHERE id='snapshot'")]));
  const snapshots = await Promise.all(reads); await Promise.all(writes);
  for (const r of snapshots) expect((r[0].results[0] as {revision: number}).revision).toBe((r[1].results[0] as {revision: number}).revision);
});
test("unready_metadata_fences_guard_without_retryable_marker", async () => {
  await db.prepare("UPDATE id_metadata SET readiness='initializing'").run();
  await expect(db.batch([guard("unready", 21), db.prepare("DELETE FROM id_accounts")])).rejects.toThrow(/DYA_ID_STORAGE_NOT_READY/);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM id_accounts").first("n")).toBeGreaterThan(0);
});
