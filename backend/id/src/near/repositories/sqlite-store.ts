import { encodeFinancialRecord, decodeFinancialRecord } from "./financial-history";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { State, StateStore } from "./store";

export class Store implements StateStore {
  private db: DatabaseSync;
  constructor(path: string, private readonly origin = "http://localhost:3101") {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS local_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)",
    );
    this.db
      .prepare("INSERT OR IGNORE INTO local_state VALUES(1, ?)")
      .run(JSON.stringify({ accounts: {}, sessions: {}, challenges: {}, requests: [] } satisfies State));
  }
  private transform(state: State, encode: boolean): State {
    const result = { ...state };
    for (const field of ["accounts", "challenges", "liveOrders", "liveTrades", "deposits", "withdrawals"] as const) {
      if (state[field]) Object.defineProperty(result, field, { value: Object.fromEntries(Object.entries(state[field]!).map(([id, value]) => [id, (encode ? encodeFinancialRecord : decodeFinancialRecord)(field, id, value, this.origin)])), enumerable: true, writable: true });
    }
    return result;
  }
  read<T>(fn: (state: State) => T): T {
    const row = this.db.prepare("SELECT body FROM local_state WHERE id=1").get() as { body: string };
    return fn(this.transform(JSON.parse(row.body) as State, false));
  }
  transaction<T>(fn: (state: State) => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT body FROM local_state WHERE id=1")
        .get() as { body: string };
      const state = this.transform(JSON.parse(row.body) as State, false);
      const result = fn(state);
      this.db
        .prepare("UPDATE local_state SET body=? WHERE id=1")
        .run(JSON.stringify(this.transform(state, true)));
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
