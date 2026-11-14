import { afterEach, beforeEach, expect, test } from "vitest";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { harness, origin, synchronized } from "./d1-harness";
import { D1Store } from "../src/near/repositories/d1-store";
import type { D1Client } from "../src/near/repositories/d1-records";
import { StatementBudget } from "../src/near/repositories/request-budget";
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.mf.dispose(); });
const store = (db = h.db) => new D1Store(db, origin, new StatementBudget("paid"));
const account = (id: string) => ({ id, kind: "passkey" as const, counter: 0 });
function interfere(action: () => Promise<unknown>): D1Client {
  let ran = false;
  return { prepare: h.db.prepare.bind(h.db), async batch<T>(statements: D1PreparedStatement[]) {
    if (statements.length !== 1 && !ran) { ran = true; await action(); }
    return h.db.batch<T>(statements);
  } };
}
test("read_only_authorization_dependency_fences_write_to_another_record", async () => {
  await store().transaction(s => { s.accounts.a = account("a"); s.accounts.b = account("b"); });
  const db = interfere(() => h.raw.prepare("UPDATE id_accounts SET data=json_set(data,'$.counter',1) WHERE id='a'").run());
  let attempts = 0;
  await expect(store(db).transaction(s => { attempts++; if (s.accounts.a.counter !== 0) throw new Error("revoked"); s.accounts.b.counter = 1; })).rejects.toThrow("revoked");
  expect(attempts).toBe(2);
  expect(await store().read(s => s.accounts.b.counter)).toBe(0);
});
test("collection_scan_fences_registration_phantoms", async () => {
  const db = interfere(() => h.raw.prepare("INSERT INTO id_accounts VALUES('a',?)").bind(JSON.stringify({ ...account("a"), credentialId: "credential" })).run());
  await expect(store(db).transaction(s => {
    if (Object.values(s.accounts).some(a => a.credentialId === "credential")) throw new Error("duplicate");
    s.accounts.b = { ...account("b"), credentialId: "credential" };
  })).rejects.toThrow("duplicate");
  expect(await store().read(s => Object.keys(s.accounts))).toEqual(["a"]);
});
test("absent_record_claim_has_one_winner", async () => {
  const db = synchronized(h.db);
  const results = await Promise.allSettled([1, 2].map(() => store(db).transaction(s => {
    if (s.accounts.a) throw new Error("already claimed");
    s.accounts.a = account("a");
  })));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
});
test("tombstone_fences_identical_delete_and_recreate", async () => {
  await store().transaction(s => { s.accounts.a = account("a"); s.sessions.session = { accountId: "a", expires: 123 }; });
  const db = interfere(async () => {
    await h.raw.prepare("DELETE FROM id_sessions WHERE id='session'").run();
    await h.raw.prepare("INSERT INTO id_sessions VALUES('session',?)").bind(JSON.stringify({ accountId: "a", expires: 123 })).run();
  });
  let attempts = 0;
  await store(db).transaction(s => { attempts++; if (!s.sessions.session) throw new Error("revoked"); s.accounts.a.counter = 1; });
  expect(attempts).toBe(2);
  expect(await store().read(s => s.accounts.a.counter)).toBe(1);
});
test("cross_record_write_skew_is_rejected", async () => {
  await store().transaction(s => { s.accounts.a = account("a"); s.accounts.b = account("b"); });
  const db = synchronized(h.db);
  const results = await Promise.allSettled(["a", "b"].map(id => store(db).transaction(s => {
    if (s.accounts.a.counter || s.accounts.b.counter) throw new Error("claimed");
    s.accounts[id].counter = 1;
  })));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(await store().read(s => (s.accounts.a.counter ?? 0) + (s.accounts.b.counter ?? 0))).toBe(1);
});
test("readiness_delete_and_restore_is_fenced", async () => {
  const db = interfere(async () => {
    await h.raw.prepare("UPDATE id_metadata SET readiness='initializing'").run();
    await h.raw.prepare("UPDATE id_metadata SET readiness='ready'").run();
  });
  let attempts = 0;
  await store(db).transaction(s => { attempts++; s.accounts.a = account("a"); });
  expect(attempts).toBe(2);
});
test("shared_rate_history_has_no_lost_update", async () => {
  const db = synchronized(h.db);
  await Promise.all([1, 2].map(value => store(db).transaction(s => { s.requests.push(value); })));
  expect(await store().read(s => [...s.requests].sort())).toEqual([1, 2]);
});
test("returned_collection_is_a_plain_snapshot", async () => {
  const result = await store().transaction(s => { s.accounts.a = account("a"); return { accounts: s.accounts }; });
  expect(structuredClone(result)).toEqual({ accounts: { a: account("a") } });
});
test("failed_dependency_guard_rolls_back_prior_rows_and_version_triggers", async () => {
  await store().transaction(s => { s.accounts.a = account("a"); });
  const before = await h.raw.prepare("SELECT * FROM id_versions ORDER BY collection,record_id").all();
  await expect(h.db.batch([
    h.db.prepare("INSERT INTO id_accounts VALUES('b',?)").bind(JSON.stringify(account("b"))),
    h.db.prepare("INSERT INTO id_write_guards VALUES('failed',0,?,2,?)").bind(origin, JSON.stringify([{collection:"accounts",id:"a",version:0}])),
  ])).rejects.toThrow(/DYA_ID_REVISION_CONFLICT/);
  expect(await store().read(s => s.accounts.b)).toBeUndefined();
  expect((await h.raw.prepare("SELECT * FROM id_versions ORDER BY collection,record_id").all()).results).toEqual(before.results);
  expect(await h.raw.prepare("SELECT count(*) n FROM id_write_guards").first("n")).toBe(0);
});
test("later_constraint_failure_rolls_back_guard_rows_and_versions", async () => {
  const before = await h.raw.prepare("SELECT * FROM id_versions ORDER BY collection,record_id").all();
  await expect(h.db.batch([
    h.db.prepare("INSERT INTO id_write_guards VALUES('failed',0,?,2,'[]')").bind(origin),
    h.db.prepare("INSERT INTO id_accounts VALUES('a',?)").bind(JSON.stringify(account("a"))),
    h.db.prepare("INSERT INTO id_sessions VALUES('invalid','not-json')"),
  ])).rejects.toThrow();
  expect(await store().read(s => s.accounts.a)).toBeUndefined();
  expect((await h.raw.prepare("SELECT * FROM id_versions ORDER BY collection,record_id").all()).results).toEqual(before.results);
  expect(await h.raw.prepare("SELECT count(*) n FROM id_write_guards").first("n")).toBe(0);
});
