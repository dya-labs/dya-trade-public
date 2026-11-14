import { decodeFinancialRecord } from "./financial-history";
import { loadRecords, saveChangedRecords } from "./entity-records";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { Client, neon } from "@neondatabase/serverless";
import { hash, type State, type StateStore, type RecordScope } from "./store";

/** Hot wallet paths use record-scoped snapshots and locks. Legacy workflows retain
 * full-state transactions; both writers lock entity rows in the same order. */
export class PostgresStore implements StateStore {
  constructor(private connectionString: string, private origin: string, private scope?: RecordScope) {}

  scoped(scope: RecordScope): StateStore {
    return new PostgresStore(this.connectionString, this.origin, scope);
  }
  private async scopedState(client: Pick<Client, "query">, write: boolean, requests: number[] = []): Promise<State> {
    const sessions = this.scope?.session ? [hash(this.scope.session)] : [];
    const challenges = this.scope?.challenges ?? [];
    if (!write) {
      // One statement gives reads a consistent snapshot without a transaction or full-table scan.
      const { rows } = await client.query<{ origin: string; state: State }>(`
        SELECT origin, jsonb_build_object('requests', requests,
          'accounts', COALESCE((SELECT jsonb_object_agg(id, data) FROM terminal_accounts WHERE id IN
            (SELECT data->>'accountId' FROM terminal_sessions WHERE id = ANY($1::text[]))), '{}'::jsonb),
          'sessions', COALESCE((SELECT jsonb_object_agg(id, data) FROM terminal_sessions WHERE id = ANY($1::text[])), '{}'::jsonb),
          'challenges', COALESCE((SELECT jsonb_object_agg(id, data) FROM terminal_challenges WHERE id = ANY($2::text[])), '{}'::jsonb)
        ) AS state FROM terminal_metadata WHERE id = 1`, [sessions, challenges]);
      const row = rows[0];
      if (!row || row.origin !== this.origin) throw new AppError(ErrorCode.DatabaseOriginMismatchOrMigrationMissing);
      row.state.accounts = Object.fromEntries(Object.entries(row.state.accounts).map(([id, value]) => [id, decodeFinancialRecord("accounts", id, value, this.origin)])) as State["accounts"];
      row.state.challenges = Object.fromEntries(Object.entries(row.state.challenges).map(([id, value]) => [id, decodeFinancialRecord("challenges", id, value, this.origin)])) as State["challenges"];
      return row.state;
    }
    // Lock in the same accounts/sessions/challenges order as the full-state adapter.
    // Re-read after locking so expiry, revocation and challenge consumption stay authoritative.
    const accountRows = await client.query<{ id: string; data: State['accounts'][string] }>(
      "SELECT id, data FROM terminal_accounts WHERE id IN (SELECT data->>'accountId' FROM terminal_sessions WHERE id = ANY($1::text[])) ORDER BY id FOR UPDATE", [sessions]);
    const sessionRows = await client.query<{ id: string; data: State['sessions'][string] }>(
      "SELECT id, data FROM terminal_sessions WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE", [sessions]);
    const challengeRows = await client.query<{ id: string; data: State['challenges'][string] }>(
      "SELECT id, data FROM terminal_challenges WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE", [challenges]);
    return { requests, accounts: Object.fromEntries(accountRows.rows.map(r => [r.id, decodeFinancialRecord("accounts", r.id, r.data, this.origin)])) as State["accounts"],
      sessions: Object.fromEntries(sessionRows.rows.map(r => [r.id, r.data])),
      challenges: Object.fromEntries(challengeRows.rows.map(r => [r.id, decodeFinancialRecord("challenges", r.id, r.data, this.origin)])) as State["challenges"] };
  }

  read<T>(fn: (state: State) => T): Promise<T> {
    return this.access(fn, false);
  }
  transaction<T>(fn: (state: State) => T): Promise<T> {
    return this.access(fn, true);
  }
  private async access<T>(fn: (state: State) => T, write: boolean): Promise<T> {
    if (this.scope && !write) {
      const started = Date.now();
      let callback = false;
      try {
        const sql = neon(this.connectionString, { fullResults: true });
        const state = await this.scopedState({ query: (query: string, values?: unknown[]) => sql.query(query, values, { fetchOptions: { signal: AbortSignal.timeout(10000) } }) } as Pick<Client, "query">, false);
        callback = true;
        return fn(state);
      } catch (error) {
        if (callback) throw error;
        console.error("terminal.database", { category: error instanceof AppError ? error.code : "DATABASE_FAILURE" });
        throw new AppError(ErrorCode.DatabaseUnavailableCheckItsConnectionMigrationAndConfiguredOrigin);
      } finally {
        console.info("wallet.storage.duration", { scope: "records", operation: "read", durationMs: Date.now() - started });
      }
    }
    const client = new Client({ connectionString: this.connectionString, connectionTimeoutMillis: 10000 });
    let callbackError = false;
    const started = Date.now();
    try {
      await client.connect();
      await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '10s', true)");
      const { rows } = await client.query<{ requests: number[]; origin: string }>(
        `SELECT requests, origin FROM terminal_metadata WHERE id = 1${write && (!this.scope || this.scope.rateLimit) ? " FOR UPDATE" : ""}`,
      );
      const row = rows[0];
      if (!row || row.origin !== this.origin) throw new AppError(ErrorCode.DatabaseOriginMismatchOrMigrationMissing);
      const state = this.scope ? await this.scopedState(client, true, row.requests) : await loadRecords(client, row.requests, write, this.origin);
      const before = write ? structuredClone(state) : state;
      let result: T;
      try {
        result = fn(state);
        if (result instanceof Promise) throw new AppError(ErrorCode.StorageCallbacksMustBeSynchronous);
      } catch (error) { callbackError = true; throw error; }
      if (write) {
        if (this.scope && !this.scope.rateLimit && JSON.stringify(before.requests) !== JSON.stringify(state.requests))
          throw new Error("Rate-limit writes require the metadata lock");
        await saveChangedRecords(client, before, state, this.origin);
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      // Never expose driver errors, connection strings, or serialized account state.
      if (callbackError) throw error;
      const sqlCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : undefined;
      console.error("terminal.database", { category: error instanceof AppError ? error.code : "DATABASE_FAILURE", sqlCode });
      throw new AppError(ErrorCode.DatabaseUnavailableCheckItsConnectionMigrationAndConfiguredOrigin);
    } finally {
      await client.end().catch(() => undefined);
      console.info("wallet.storage.duration", { scope: this.scope ? "records" : "full", operation: write ? "write" : "read", durationMs: Date.now() - started });
    }
  }
}
