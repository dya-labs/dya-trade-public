import { expect, test } from "vitest";
import { harness, origin, synchronized } from "./d1-harness";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { StorageBudgetExceededError, StorageUnavailableError } from "../src/near/repositories/storage-error";
import { saveChallenge } from "../src/near/services/workflow-context";
import { hash, consumeChallenge } from "../src/near/repositories/store";
import type { D1Client } from "../src/near/repositories/d1-records";
import type { D1PreparedStatement } from "@cloudflare/workers-types";

const challenge = () => ({ purpose: "login" as const, value: "synthetic", expires: Date.now() + 300000 });
test("twenty_atomic_authentication_writes_all_commit_and_global_limit_is_exact", async () => {
  const h = await harness();
  try {
    const budgets = Array.from({ length: 20 }, () => new StatementBudget("free"));
    const result = await Promise.allSettled(budgets.map(b => saveChallenge(new D1Store(h.db, origin, b), challenge(), undefined)));
    expect(result.every(r => r.status === "fulfilled")).toBe(true);
    const s = new D1Store(h.db, origin, new StatementBudget("paid"));
    expect(await s.read(s => s.requests.length)).toBe(20);
    expect(budgets.map(b => b.used)).toEqual(Array(20).fill(8));
    const limit = await Promise.allSettled(Array.from({ length: 45 }, () => saveChallenge(new D1Store(h.db, origin, new StatementBudget("free")), challenge(), undefined)));
    expect(limit.filter(r => r.status === "fulfilled")).toHaveLength(40);
    expect(limit.filter(r => r.status === "rejected")).toHaveLength(5);
    for (const r of limit) if (r.status === "rejected") expect(r.reason.message).toMatch(/Too many authentication requests/i);
    expect(await s.read(s => ({ requests: s.requests.length, challenges: Object.keys(s.challenges).length }))).toEqual({ requests: 60, challenges: 60 });
  } finally { await h.mf.dispose(); }
});

test("replacement_expiry_bounded_cleanup_and_single_use_preserved", async () => {
  const h = await harness();
  try {
    const s = new D1Store(h.db, origin, new StatementBudget("paid"));
    const previous = await saveChallenge(s, challenge(), undefined);
    await s.transaction(s => {
      s.requests = [Date.now() - 60001];
      for (let i = 0; i < 150; i++) {
        s.challenges[`expired-${i}`] = { ...challenge(), expires: 0 };
        s.sessions[`expired-${i}`] = { accountId: "expired", expires: 0 };
      }
      s.sessions.valid = { accountId: "valid", expires: Date.now() + 60000 };
    });
    const raw = await saveChallenge(s, challenge(), previous);
    expect(await s.read(s => s.challenges[hash(previous)])).toBeUndefined();
    expect(await s.read(s => Object.keys(s.sessions).length)).toBe(51);
    expect(await s.read(s => s.requests.length)).toBe(1);
    const barrier = synchronized(h.db);
    const consumed = await Promise.allSettled([1, 2].map(() => consumeChallenge(new D1Store(barrier, origin, new StatementBudget("free")), raw, "login")));
    expect(consumed.filter(r => r.status === "fulfilled")).toHaveLength(1);
  } finally { await h.mf.dispose(); }
});

test("denial_and_batch_failure_preserve_previous_challenge_and_history", async () => {
  const h = await harness();
  try {
    const s = new D1Store(h.db, origin, new StatementBudget("paid"));
    const old = await saveChallenge(s, challenge(), undefined);
    await s.transaction(s => { s.requests = Array(60).fill(Date.now()); });
    await expect(saveChallenge(s, challenge(), old)).rejects.toThrow(/Too many authentication requests/i);
    expect(await s.read(s => !!s.challenges[hash(old)])).toBe(true);
    await s.transaction(s => { s.requests = []; });
    await h.raw.prepare("CREATE TRIGGER reject_test_challenge BEFORE INSERT ON id_challenges BEGIN SELECT RAISE(ABORT,'SYNTHETIC_FAILURE'); END").run();
    await expect(saveChallenge(s, challenge(), old)).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(await s.read(s => ({ old: !!s.challenges[hash(old)], requests: s.requests.length }))).toEqual({ old: true, requests: 0 });
    expect(await h.raw.prepare("SELECT count(*) n FROM id_write_guards").first("n")).toBe(0);
  } finally { await h.mf.dispose(); }
});

test("wrong_origin_unready_corrupt_history_budget_and_ambiguous_result_fail_closed", async () => {
  const h = await harness();
  try {
    const command = (db = h.db, target = origin, budget = new StatementBudget("free")) => saveChallenge(new D1Store(db, target, budget), challenge(), undefined);
    await expect(command(h.db, "https://wrong.invalid")).rejects.toBeInstanceOf(StorageUnavailableError);
    await h.raw.prepare("UPDATE id_metadata SET readiness='initializing'").run();
    await expect(command()).rejects.toBeInstanceOf(StorageUnavailableError);
    await h.raw.prepare("UPDATE id_metadata SET readiness='ready',requests='[true]'").run();
    await expect(command()).rejects.toBeInstanceOf(StorageUnavailableError);
    await h.raw.prepare("UPDATE id_metadata SET requests='[]'").run();
    const budget = new StatementBudget("free"); budget.reserveStatements(33, false);
    await expect(command(h.db, origin, budget)).rejects.toBeInstanceOf(StorageBudgetExceededError);
    let batches = 0;
    const ambiguous: D1Client = { prepare: h.db.prepare.bind(h.db), async batch(statements) {
      batches++; await h.db.batch(statements); throw new Error("synthetic post-commit disconnect");
    } };
    await expect(command(ambiguous)).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(batches).toBe(1);
    expect(await h.raw.prepare("SELECT count(*) n FROM id_challenges").first("n")).toBe(1);
  } finally { await h.mf.dispose(); }
});

test("atomic_command_fences_generic_snapshot_transactions", async () => {
  const h = await harness();
  try {
    const s = new D1Store(h.db, origin, new StatementBudget("paid"));
    await s.transaction(s => { s.accounts.a = { id: "a", kind: "passkey", counter: 0 }; });
    let snapshots = 0;
    const interleaved: D1Client = { prepare: h.db.prepare.bind(h.db), async batch<T>(statements: D1PreparedStatement[]) {
      const result = await h.db.batch<T>(statements);
      if (statements.length === 1 && ++snapshots === 1) await saveChallenge(s, challenge(), undefined);
      return result;
    } };
    await new D1Store(interleaved, origin, new StatementBudget("free")).transaction(s => {
      s.accounts.a.counter = s.requests.length + Object.keys(s.challenges).length;
    });
    expect(snapshots).toBe(2);
    expect(await s.read(s => s.accounts.a.counter)).toBe(2);
  } finally { await h.mf.dispose(); }
});
