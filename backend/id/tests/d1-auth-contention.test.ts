import { expect, test } from "vitest";
import type { D1Client } from "../src/near/repositories/d1-records";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { StorageConflictError } from "../src/near/repositories/storage-error";
import { saveChallenge } from "../src/near/services/workflow-context";
import { harness, origin, synchronized } from "./d1-harness";

// Diagnostic regression: exposes the shared authentication write bottleneck.
// A passing diagnostic means failure was reproduced, not that T7 throughput passed.
test("shared_authentication_history_and_cleanup_scans_exhaust_three_attempts", async () => {
  const h = await harness();
  try {
    let conflicts = 0;
    const dependencyCollections = new Set<string>();
    const bindings = new WeakMap<D1PreparedStatement, string[]>();
    const db: D1Client = {
      prepare(sql) {
        const statement = h.db.prepare(sql);
        if (!sql.startsWith("INSERT INTO id_write_guards")) return statement;
        return new Proxy(statement, { get(target, property) {
          if (property === "bind") return (...values: Parameters<D1PreparedStatement["bind"]>) => {
            const bound = target.bind(...values);
            bindings.set(bound, JSON.parse(String(values[4])).map((d: { collection: string }) => d.collection));
            return bound;
          };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      },
      async batch<T>(statements: D1PreparedStatement[]) {
        for (const collection of bindings.get(statements[0]) ?? []) dependencyCollections.add(collection);
        try { return await h.db.batch<T>(statements); }
        catch (error) {
          if (error instanceof Error && error.message.includes("DYA_ID_REVISION_CONFLICT")) conflicts++;
          throw error;
        }
      },
    };
    const barrier = synchronized(db, 20);
    const budgets = Array.from({ length: 20 }, () => new StatementBudget("free"));
    const results = await Promise.allSettled(budgets.map((budget, i) => {
      const store = new D1Store(barrier, origin, budget);
      return saveChallenge(
      { read: store.read.bind(store), transaction: store.transaction.bind(store) },
      { purpose: "login", value: `synthetic-${i}`, expires: Date.now() + 300000 },
      undefined,
    ); }));
    const failed = results.filter(r => r.status === "rejected");
    for (const result of failed) if (result.status === "rejected") expect(result.reason).toBeInstanceOf(StorageConflictError);
    const state = await new D1Store(h.db, origin, new StatementBudget("free")).read(s => ({ challenges: Object.keys(s.challenges).length, requests: s.requests.length }));
    expect(state.challenges).toBe(20 - failed.length);
    expect(state.requests).toBe(20 - failed.length);
    expect(failed.length).toBeGreaterThan(0);
    expect(budgets.every(b => b.used <= 40 && !b.exhausted)).toBe(true);
    expect(dependencyCollections).toEqual(new Set(["metadata", "challenges", "sessions", "requests"]));
    const evidence = { scope: "Real local D1; synchronized first snapshots; not hosted telemetry", clients: 20,
      succeeded: 20 - failed.length, failed: failed.length, failureCategory: "ID_STORAGE_CONFLICT", conflicts,
      dependencyCollections: [...dependencyCollections].sort(), reservedUnits: budgets.map(b => b.used), persisted: state };
    console.info("id.d1.auth.contention", JSON.stringify(evidence));
  } finally { await h.mf.dispose(); }
}, 30000);
