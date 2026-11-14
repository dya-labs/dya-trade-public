import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { afterEach, beforeEach, expect, test } from "vitest";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { StorageUnavailableError, StorageConflictError, StorageBudgetExceededError } from "../src/near/repositories/storage-error";
import { harness, origin, synchronized } from "./d1-harness";
import { initializeMetadata, activateEmptyDatabase } from "../scripts/d1-initialization.mjs";
import type { D1Client } from "../src/near/repositories/d1-records";
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h?.mf.dispose(); });
const store = (db: D1Client = h.db, profile = "paid") => new D1Store(db, origin, new StatementBudget(profile));
const account = (id: string) => ({ id, kind: "passkey" as const, counter: 0 });
test("migration_and_init_are_idempotent", async () => {
  await store().transaction(s => { s.accounts.a = account("a"); s.requests = [123]; });
  const before = await h.raw.prepare("SELECT * FROM id_metadata").first();
  await initializeMetadata(h.raw, origin); await activateEmptyDatabase(h.raw, origin);
  expect(await h.raw.prepare("SELECT * FROM id_metadata").first()).toEqual(before);
  expect(await store().read(s => s.accounts.a.id)).toBe("a");
});
test("wrong_origin_and_missing_metadata_fail_closed", async () => {
  let called = false;
  await expect(new D1Store(h.db, "https://other.example", new StatementBudget("paid")).read(() => { called = true; })).rejects.toBeInstanceOf(StorageUnavailableError);
  await h.raw.prepare("DELETE FROM id_metadata").run();
  await expect(store().transaction(() => { called = true; })).rejects.toBeInstanceOf(StorageUnavailableError);
  expect(called).toBe(false);
});
test("callback_throw_and_thenable_do_not_write", async () => {
  const revision = await h.raw.prepare("SELECT revision FROM id_metadata").first("revision");
  await expect(store().transaction(s => { s.accounts.a = account("a"); throw new Error("business"); })).rejects.toThrow("business");
  await expect(store().transaction(s => { s.accounts.a = account("a"); return { then() {} }; })).rejects.toBeInstanceOf(StorageUnavailableError);
  await expect(store().transaction(() => new Error("not success"))).rejects.toBeInstanceOf(StorageUnavailableError);
  expect(await store().read(s => s.accounts)).toEqual({});
  expect(await h.raw.prepare("SELECT revision FROM id_metadata").first("revision")).toBe(revision);
});
test("read_mutation_is_not_persisted", async () => {
  await store().read(s => { s.accounts.a = account("a"); });
  expect(await store().read(s => s.accounts)).toEqual({});
});
test("held_snapshot_answers_its_reads_from_one_batch", async () => {
  await store().transaction(s => { s.accounts.a = account("a"); });
  let batches = 0;
  const db: D1Client = { prepare: h.db.prepare.bind(h.db), async batch(s) { batches++; return h.db.batch(s); } };
  const held = await new D1Store(db, origin, new StatementBudget("paid")).hold();
  await store().transaction(s => { s.accounts.b = account("b"); });
  expect(await held.read(s => Object.keys(s.accounts))).toEqual(["a"]);
  expect(await held.read(s => s.accounts.a.id)).toBe("a");
  expect(batches).toBe(1);
  await expect(new D1Store(h.db, "https://other.example", new StatementBudget("paid")).hold()).rejects.toBeInstanceOf(StorageUnavailableError);
});
test("different_accounts_preserve_both_updates", async () => {
  const db = synchronized(h.db);
  await Promise.all(["a", "b"].map(id => store(db).transaction(s => { s.accounts[id] = account(id); })));
  expect(Object.keys(await store().read(s => s.accounts)).sort()).toEqual(["a", "b"]);
});
test("retries_are_bounded_and_results_are_not_leaked", async () => {
  let calls = 0, reads = 0;
  const db: D1Client = { prepare: h.db.prepare.bind(h.db), async batch<T>(statements: D1PreparedStatement[]) {
    if (statements.length === 1) { reads++; return h.db.batch<T>(statements); }
    throw new Error("D1_ERROR: DYA_ID_REVISION_CONFLICT: SQLITE_CONSTRAINT");
  } };
  await expect(store(db).transaction(s => { calls++; s.accounts.a = account("a"); return "proposed-result"; })).rejects.toBeInstanceOf(StorageConflictError);
  expect(calls).toBe(3); expect(reads).toBe(3);
  expect(await store().read(s => s.accounts)).toEqual({});
});
test("unknown_batch_outcome_is_not_replayed", async () => {
  let calls = 0;
  const db: D1Client = { prepare: h.db.prepare.bind(h.db), async batch<T>(statements: D1PreparedStatement[]) {
    const result = await h.db.batch<T>(statements);
    if (statements.length !== 1) throw new Error("transport disconnected after commit");
    return result;
  } };
  await expect(store(db).transaction(s => { calls++; s.accounts.a = account("a"); })).rejects.toBeInstanceOf(StorageUnavailableError);
  expect(calls).toBe(1); expect(await store().read(s => s.accounts.a.id)).toBe("a");
});
test("initialization_readiness_and_empty_activation", async () => {
  await h.mf.dispose(); h = await harness(false);
  let called = false;
  await expect(store().read(() => { called = true; })).rejects.toBeInstanceOf(StorageUnavailableError);
  await expect(store().transaction(() => { called = true; })).rejects.toBeInstanceOf(StorageUnavailableError);
  expect(called).toBe(false);
  await expect(h.raw.prepare("INSERT INTO id_write_guards VALUES('test',0,?,2,'[]')").bind(origin).run()).rejects.toThrow(/DYA_ID_STORAGE_NOT_READY/);
  await h.raw.prepare("INSERT INTO id_accounts VALUES('a',?)").bind(JSON.stringify(account("a"))).run();
  await expect(activateEmptyDatabase(h.raw, origin)).rejects.toThrow("activation refused");
  expect(await h.raw.prepare("SELECT readiness FROM id_metadata").first("readiness")).toBe("initializing");
  expect(await h.raw.prepare("SELECT revision FROM id_metadata").first("revision")).toBe(0);
  await h.raw.prepare("DELETE FROM id_accounts").run();
  await activateEmptyDatabase(h.raw, origin);
  await activateEmptyDatabase(h.raw, origin);
  expect(await h.raw.prepare("SELECT revision FROM id_metadata").first("revision")).toBe(1);
});
test("readiness_change_fences_stale_writer", async () => {
  let reads = 0;
  const db: D1Client = { prepare: h.db.prepare.bind(h.db), async batch<T>(statements: D1PreparedStatement[]) {
    const result = await h.db.batch<T>(statements);
    if (statements.length === 1) { reads++; await h.raw.prepare("UPDATE id_metadata SET readiness='initializing'").run(); }
    return result;
  } };
  await expect(store(db).transaction(s => { s.accounts.a = account("a"); })).rejects.toBeInstanceOf(StorageUnavailableError);
  expect(reads).toBe(1); expect(await h.raw.prepare("SELECT count(*) n FROM id_accounts").first("n")).toBe(0);
});
test("corrupt_state_newer_schema_and_missing_tables_fail_closed", async () => {
  await h.raw.prepare("INSERT INTO id_accounts VALUES('a',?)").bind('{"id":"other","kind":"passkey"}').run();
  await expect(store().read(() => "no")).rejects.toBeInstanceOf(StorageUnavailableError);
  await h.raw.prepare("DELETE FROM id_accounts").run();
  await h.raw.prepare("UPDATE id_metadata SET schema_version=3").run();
  await expect(store().read(() => "no")).rejects.toBeInstanceOf(StorageUnavailableError);
  await h.raw.prepare("DROP TABLE id_trades").run();
  await expect(store().read(() => "no")).rejects.toBeInstanceOf(StorageUnavailableError);
});
test("nested_scopes_share_budget_and_no_dispatch_after_exhaustion", async () => {
  let batches = 0;
  const db: D1Client = { prepare: h.db.prepare.bind(h.db), async batch(s) { batches++; return h.db.batch(s); } };
  const budget = new StatementBudget("free");
  budget.reserveStatements(36, false);
  const s = new D1Store(db, origin, budget);
  await s.read(() => 1);
  await expect(s.scoped({}).transaction(() => 2)).rejects.toBeInstanceOf(StorageBudgetExceededError);
  await expect(s.read(() => 1)).rejects.toBeInstanceOf(StorageBudgetExceededError);
  expect(batches).toBe(1); expect(budget.used).toBe(39);
});
test("saving_a_challenge_prunes_only_tombstones_of_deleted_challenges_and_sessions", async () => {
  const challenge = { purpose: "login" as const, value: "synthetic", expires: Date.now() + 60000 };
  const session = { accountId: "a", expires: Date.now() + 60000 };
  await store().transaction(s => { s.accounts.gone = account("gone"); s.sessions.dead = session; s.sessions.live = session; s.challenges.dead = challenge; s.challenges.kept = challenge; });
  await store().transaction(s => { delete s.accounts.gone; delete s.sessions.dead; delete s.challenges.dead; });
  const versions = async () => (await h.raw.prepare("SELECT collection||':'||record_id AS k FROM id_versions WHERE record_id<>'' AND collection IN ('accounts','challenges','sessions') ORDER BY k").all<{ k: string }>()).results.map(r => r.k);
  expect(await versions()).toEqual(["accounts:gone", "challenges:dead", "challenges:kept", "sessions:dead", "sessions:live"]);
  // Pruning lands between each transaction's snapshot and its commit.
  const interleaved = (id: string) => {
    let pruned = false, snapshots = 0;
    const db: D1Client = { prepare: h.db.prepare.bind(h.db), async batch<T>(statements: D1PreparedStatement[]) {
      if (statements.length === 1) snapshots++;
      else if (!pruned) { pruned = true; await store().saveChallenge(id, challenge, undefined, Date.now()); }
      return h.db.batch<T>(statements);
    } };
    return { store: new D1Store(db, origin, new StatementBudget("paid")), snapshots: () => snapshots };
  };
  const unrelated = interleaved("first");
  await unrelated.store.transaction(s => { s.accounts.a = account("a"); });
  expect(unrelated.snapshots()).toBe(1);
  // A transaction holding a pruned tombstone conflicts and retries on a fresh snapshot.
  await store().transaction(s => { delete s.challenges.first; });
  const holder = interleaved("second");
  await holder.store.transaction(s => { s.accounts.b = { ...account("b"), counter: s.challenges.first ? 1 : 0 }; });
  expect(holder.snapshots()).toBe(2);
  expect(await versions()).toEqual(["accounts:a", "accounts:b", "accounts:gone", "challenges:kept", "challenges:second", "sessions:live"]);
});
test("grouped_delete_and_upsert_constraint_failure_rolls_back_every_record_and_version", async () => {
  await store().transaction(s => { s.accounts.old = account("old"); });
  const before = await h.raw.prepare("SELECT * FROM id_versions ORDER BY collection,record_id").all();
  await h.raw.prepare("CREATE TRIGGER reject_fixture BEFORE INSERT ON id_accounts WHEN NEW.id='bad' BEGIN SELECT RAISE(ABORT,'synthetic rejection'); END").run();
  await expect(store().transaction(s => {
    delete s.accounts.old;
    s.accounts.good = account("good");
    s.accounts.bad = account("bad");
  })).rejects.toBeInstanceOf(StorageUnavailableError);
  expect(await store().read(s => Object.keys(s.accounts))).toEqual(["old"]);
  expect((await h.raw.prepare("SELECT * FROM id_versions ORDER BY collection,record_id").all()).results).toEqual(before.results);
  expect((await h.raw.prepare("SELECT count(*) AS n FROM id_write_guards").first<{n:number}>())!.n).toBe(0);
});
test("large_unicode_records_survive_bounded_grouping_and_single_statement_snapshot", async () => {
  const note = "🙂".repeat(270000);
  await store().transaction(s => {
    s.accounts.a = { ...account("a"), intentsAccountId: note };
    s.accounts.b = { ...account("b"), intentsAccountId: note };
  });
  expect(await store().read(s => [s.accounts.a.intentsAccountId, s.accounts.b.intentsAccountId])).toEqual([note,note]);
});
test("binding_a_ceremony_is_one_batch_that_needs_the_session_and_its_challenge_and_fences_stale_snapshots", async () => {
  const ceremony = () => ({ value: "ceremony", purpose: "market-trade" as const, accountId: "alice", expires: Date.now() + 60000 });
  const flow = (id: string) => ({ id, ceremonyId: "ceremony", challenge: { value: id, purpose: "hosted-flow" as const, accountId: "alice", expires: Date.now() + 60000, hostedFlow: { kind: "approval" as const, clientOrigin: "https://app.test", callback: "https://app.test/callback", verifierHash: "verifier", status: "pending" as const, review: { title: "Review market trade" } } } });
  const budget = new StatementBudget("paid"), binder = new D1Store(h.db, origin, budget);
  await binder.transaction(s => { s.sessions.grant = { accountId: "alice", expires: Date.now() + 60000, clientOrigin: "https://app.test" }; s.challenges.ceremony = ceremony(); });
  // A transaction that read the session before the binding must retry on the bound session, not commit over it.
  let interleaved: Promise<{ session: boolean; flow: boolean }> | undefined;
  const racing: D1Client = { prepare: h.db.prepare.bind(h.db), async batch<T>(statements: D1PreparedStatement[]) {
    const result = await h.db.batch<T>(statements);
    if (statements.length === 1 && !interleaved) { const batches = budget.batches; interleaved = binder.bindCeremony("grant", "first", flow("flow-1")); await interleaved; expect(budget.batches - batches).toBe(1); }
    return result;
  } };
  expect(await store(racing).transaction(s => { const seen = s.sessions.grant.ceremony; s.sessions.grant.expires += 1; return seen; })).toBe("first");
  expect(await interleaved).toEqual({ session: true, flow: true });
  expect(await store().read(s => ({ origin: s.sessions.grant.clientOrigin, review: s.challenges["flow-1"].hostedFlow?.review }))).toEqual({ origin: "https://app.test", review: { title: "Review market trade" } });
  // The ceremony's challenge was replaced meanwhile: the session still names the new ceremony, without a flow for it.
  await store().transaction(s => { delete s.challenges.ceremony; });
  expect(await binder.bindCeremony("grant", "second", flow("flow-2"))).toEqual({ session: true, flow: false });
  // A revoked grant gets neither.
  await store().transaction(s => { delete s.sessions.grant; s.challenges.ceremony = ceremony(); });
  expect(await binder.bindCeremony("grant", "third", flow("flow-3"))).toEqual({ session: false, flow: false });
  expect(await store().read(s => [s.sessions.grant, s.challenges["flow-2"], s.challenges["flow-3"]])).toEqual([undefined, undefined, undefined]);
});
test("saving_a_challenge_binds_its_ceremony_in_the_same_batch_or_not_at_all", async () => {
  const challenge = (value: string) => ({ value, purpose: "market-trade" as const, accountId: "alice", expires: Date.now() + 60000 });
  const bind = (name: string) => ({ sessionId: "grant", ceremony: `raw-${name}`, flow: { id: `flow-${name}`, challenge: { value: `flow-${name}`, purpose: "hosted-flow" as const, accountId: "alice", expires: Date.now() + 60000, hostedFlow: { kind: "approval" as const, clientOrigin: "https://app.test", callback: "https://app.test/callback", verifierHash: "verifier", status: "pending" as const, review: { title: "Review market trade" } } } } });
  const budget = new StatementBudget("paid"), saver = new D1Store(h.db, origin, budget);
  await saver.transaction(s => { s.sessions.grant = { accountId: "alice", expires: Date.now() + 60000, clientOrigin: "https://app.test" }; });
  // A transaction that read the session before the save must retry on the bound session, not commit over it.
  let interleaved: Promise<{ session: boolean; flow: boolean }> | undefined;
  const racing: D1Client = { prepare: h.db.prepare.bind(h.db), async batch<T>(statements: D1PreparedStatement[]) {
    const result = await h.db.batch<T>(statements);
    if (statements.length === 1 && !interleaved) { const batches = budget.batches; interleaved = saver.saveChallenge("first", challenge("first"), undefined, Date.now(), bind("first")); await interleaved; expect(budget.batches - batches).toBe(1); }
    return result;
  } };
  expect(await store(racing).transaction(s => { const seen = s.sessions.grant.ceremony; s.sessions.grant.expires += 1; return seen; })).toBe("raw-first");
  expect(await interleaved).toEqual({ session: true, flow: true });
  expect(await store().read(s => ({ saved: s.challenges.first.value, origin: s.sessions.grant.clientOrigin, review: s.challenges["flow-first"].hostedFlow?.review }))).toEqual({ saved: "first", origin: "https://app.test", review: { title: "Review market trade" } });
  // Refused by the rate limit: the grant keeps its ceremony and that ceremony's challenge, and gets no flow.
  await store().transaction(s => { s.requests = Array(60).fill(Date.now()); });
  await expect(saver.saveChallenge("second", challenge("second"), "first", Date.now(), bind("second"))).rejects.toThrow(/Too many authentication requests/i);
  expect(await store().read(s => [s.sessions.grant.ceremony, s.challenges.first.value, s.challenges.second, s.challenges["flow-second"]])).toEqual(["raw-first", "first", undefined, undefined]);
  // A revoked grant: the challenge is saved, bound to nothing and without a flow.
  await store().transaction(s => { s.requests = []; delete s.sessions.grant; });
  expect(await saver.saveChallenge("third", challenge("third"), undefined, Date.now(), bind("third"))).toEqual({ session: false, flow: false });
  expect(await store().read(s => [s.challenges.third.value, s.sessions.grant, s.challenges["flow-third"]])).toEqual(["third", undefined, undefined]);
});
