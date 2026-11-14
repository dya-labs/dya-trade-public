// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PostgresStore } from "../../../backend/id/src/near/repositories/postgres-store";
import { consumeChallenge, emptyState, hash } from "../../../backend/id/src/near/repositories/store";

let db: PGlite;
const closed = vi.hoisted(() => vi.fn());
// Real PostgreSQL engine and SQL; only the Neon network transport is substituted.
vi.mock("@neondatabase/serverless", () => ({ neon: () => ({ query: (sql: string, values?: unknown[]) => db.query(sql, values) }), Client: class {
  async connect() {}
  query(sql: string, values?: unknown[]) { return db.query(sql, values); }
  async end() { closed(); }
} }));
const origin = "https://id.example.test";
const store = () => new PostgresStore("postgres://test-only", origin);
const entities = (await readFile(new URL("../../../backend/id/migrations/002_entity_records.sql", import.meta.url), "utf8")) + (await readFile(new URL("../../../backend/id/migrations/003_access_records.sql", import.meta.url), "utf8"));
const networkMigration = (await readFile(new URL("../../../backend/id/migrations/004_networks.sql", import.meta.url), "utf8")) + (await readFile(new URL("../../../backend/id/migrations/005_tokens.sql", import.meta.url), "utf8")) + (await readFile(new URL("../../../backend/id/migrations/006_token_images.sql", import.meta.url), "utf8"));
const migration = await readFile(new URL("../../../backend/id/migrations/001_terminal_state.sql", import.meta.url), "utf8");
beforeEach(async () => {
  db = new PGlite();
  await db.exec(migration);
  await db.query("INSERT INTO terminal_state (id, origin, body) VALUES (1, $1, $2::jsonb)", [origin, JSON.stringify(emptyState())]);
  await db.exec("CREATE TABLE terminal_migrations (version integer PRIMARY KEY)");
  await db.exec(entities + networkMigration);
  closed.mockClear();
});
afterEach(async () => { await db.close(); });

it("persists state between adapter instances and survives a repeated schema migration", async () => {
  await store().transaction(s => { s.accounts.alice = { id: "alice", kind: "passkey" }; });
  await db.exec(migration);
  expect(await store().transaction(s => s.accounts.alice.id)).toBe("alice");
  expect(closed).toHaveBeenCalledTimes(2);
});

it("rolls back failed callbacks and closes the connection", async () => {
  await expect(store().transaction(s => {
    s.accounts.invalid = { id: "invalid", kind: "passkey" };
    throw new Error("Account changed. Retry.");
  })).rejects.toThrow("Account changed. Retry.");
  expect(await store().transaction(s => s.accounts)).toEqual({});
  expect(closed).toHaveBeenCalledTimes(2);
});

it("consumes a challenge once across adapter instances", async () => {
  await store().transaction(s => { s.challenges[hash("challenge-cookie")] = { value: "proof", purpose: "login", expires: Date.now() + 30000 }; });
  expect((await consumeChallenge(store(), "challenge-cookie", "login")).value).toBe("proof");
  await expect(consumeChallenge(store(), "challenge-cookie", "login")).rejects.toThrow("already used");
});

it("rejects mismatched environments without modifying state", async () => {
  const other = new PostgresStore("postgres://test-only", "https://other.example.test");
  const fn = vi.fn();
  await expect(other.transaction(fn)).rejects.toThrow("Database unavailable");
  expect(fn).not.toHaveBeenCalled();
  expect(await store().transaction(s => s)).toEqual({ ...emptyState(), networks: expect.any(Object), tokens: expect.any(Object) });
});

it("sanitizes database failures and requires an explicit migration", async () => {
  await db.exec("DROP TABLE terminal_metadata");
  await expect(store().transaction(s => s)).rejects.toThrow("Database unavailable. Check its connection, migration, and configured origin.");
  expect(closed).toHaveBeenCalledOnce();
});


it("read callbacks cannot persist changes or update the state row", async () => {
  const before = await db.query("SELECT data FROM terminal_accounts");
  await store().read(s => { s.accounts.accidental = { id: "accidental", kind: "passkey" }; });
  expect(await db.query("SELECT data FROM terminal_accounts")).toEqual(before);
});


it("migrates existing entities once and blocks obsolete writers", async () => {
  // Recreate the pre-cutover database, with a live session and pending order.
  await db.exec("DROP TRIGGER terminal_legacy_read_only ON terminal_state; DELETE FROM terminal_migrations WHERE version = 2; DELETE FROM terminal_metadata;");
  const old = emptyState();
  old.accounts.alice = { id: "alice", kind: "passkey" };
  old.sessions.session = { accountId: "alice", expires: 123456 };
  await db.query("UPDATE terminal_state SET body = $1::jsonb", [JSON.stringify(old)]);
  await db.exec(entities + networkMigration);
  expect(await store().read(s => s)).toEqual({ ...old, networks: expect.any(Object), tokens: expect.any(Object) });
  await store().transaction(s => { s.accounts.alice.counter = 7; });
  await db.exec(entities + networkMigration);
  expect(await store().read(s => s.accounts.alice.counter)).toBe(7);
  await expect(db.query("UPDATE terminal_state SET body = '{}'::jsonb")).rejects.toThrow("read-only");
  const records = await db.query("SELECT owner_id FROM terminal_sessions WHERE owner_id = 'alice'");
  expect(records.rows).toEqual([{ owner_id: "alice" }]);
});

it("loads only a selected session, its account and requested challenge without unrelated records", async () => {
  await store().transaction(s => {
    s.accounts.alice = { id: "alice", kind: "passkey" };
    s.accounts.bob = { id: "bob", kind: "passkey" };
    s.sessions[hash("alice-session")] = { accountId: "alice", expires: Date.now() + 60000 };
    s.sessions[hash("bob-session")] = { accountId: "bob", expires: Date.now() + 60000 };
    s.challenges[hash("alice-flow")] = { purpose: "hosted-flow", value: "alice-flow", expires: Date.now() + 60000 };
    s.challenges[hash("bob-flow")] = { purpose: "hosted-flow", value: "bob-flow", expires: Date.now() + 60000 };
  });
  const selected = store().scoped({ session: "alice-session", challenges: [hash("alice-flow")] });
  const state = await selected.read(s => s);
  expect(Object.keys(state.accounts)).toEqual(["alice"]);
  expect(Object.keys(state.sessions)).toEqual([hash("alice-session")]);
  expect(Object.keys(state.challenges)).toEqual([hash("alice-flow")]);
  await selected.transaction(s => { s.accounts.alice.counter = 2; delete s.challenges[hash("alice-flow")]; });
  const all = await store().read(s => s);
  expect(all.accounts.alice.counter).toBe(2);
  expect(all.accounts.bob).toBeDefined();
  expect(all.sessions[hash("bob-session")]).toBeDefined();
  expect(all.challenges[hash("bob-flow")]).toBeDefined();
  expect(all.challenges[hash("alice-flow")]).toBeUndefined();
});

it("scoped reads reject a mismatched origin and observe session revocation without caching", async () => {
  await store().transaction(s => {
    s.accounts.alice = { id: "alice", kind: "passkey" };
    s.sessions[hash("session")] = { accountId: "alice", expires: Date.now() + 60000 };
  });
  const selected = store().scoped({ session: "session" });
  expect(Object.keys(await selected.read(s => s.accounts))).toEqual(["alice"]);
  await selected.transaction(s => { delete s.sessions[hash("session")]; });
  expect(await selected.read(s => s.accounts)).toEqual({});
  const other = new PostgresStore("postgres://test-only", "https://wrong.example").scoped({ session: "session" });
  await expect(other.read(s => s)).rejects.toThrow("Database unavailable");
});

it("keeps the shared authentication rate limit when a scoped flow prepares a challenge", async () => {
  const { saveChallenge } = await import("../../../backend/id/src/near/services/workflow-context");
  const recent = Date.now();
  await store().transaction(s => { s.requests = Array(59).fill(recent); });
  const selected = store().scoped({ rateLimit: true });
  await saveChallenge(selected, { purpose: "confidential-auth", value: "proof", expires: recent + 60000 }, undefined);
  expect(await store().read(s => s.requests.length)).toBe(60);
  await expect(saveChallenge(selected, { purpose: "confidential-auth", value: "proof", expires: recent + 60000 }, undefined)).rejects.toThrow("Too many authentication requests");
  expect(await store().read(s => s.requests.length)).toBe(60);
});
