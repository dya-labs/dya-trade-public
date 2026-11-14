import { encodeFinancialRecord } from "./financial-history";
import { dependencies } from "./d1-dependencies";
import type { StateStore, State, RecordScope, Challenge, SnapshotReader, CeremonyBind } from "./store";
import type { StorageRequestContext } from "./request-budget";
import { D1_ENTITY_TABLES, D1_SCHEMA_VERSION, changedRecords, decodeCombinedSnapshot, snapshotSql, validateRecord, type D1Client } from "./d1-records";
import { StorageUnavailableError, StorageConflictError } from "./storage-error";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import type { D1PreparedStatement } from "@cloudflare/workers-types";

function synchronous<T>(result: T): T {
  if (result instanceof Error || ((typeof result === "object" && result !== null || typeof result === "function") && typeof (result as { then?: unknown }).then === "function")) throw new StorageUnavailableError();
  return result;
}
/** Only an exact driver marker from the failed guard batch permits replay. */
function revisionConflict(error: unknown): boolean {
  return error instanceof Error && /^D1_ERROR: DYA_ID_REVISION_CONFLICT(?:: SQLITE_CONSTRAINT(?:_TRIGGER)?(?: \(extended: SQLITE_CONSTRAINT_TRIGGER\))?|: SQLITE_ERROR)?$/.test(error.message);
}
export class D1Store implements StateStore {
  readonly kind = "d1";
  constructor(private readonly db: D1Client, private readonly origin: string, readonly context: StorageRequestContext) {}
  private async batch(statements: D1PreparedStatement[]) {
    const started = performance.now();
    try {
      const results = await this.db.batch(statements);
      this.context.observeBatch?.(results.map(r => r.meta), false, performance.now() - started);
      return results;
    } catch (error) { this.context.observeBatch?.([], true, performance.now() - started); throw error; }
  }
  // Scopes are performance hints, never authorization.
  scoped(scope: RecordScope): D1Store { void scope; return new D1Store(this.db, this.origin, this.context); }
  async hold(): Promise<SnapshotReader> {
    const { state } = await this.snapshot(false);
    return { read: <T,>(fn: (state: State) => T) => synchronous(fn(state)) };
  }
  /** One serialized batch evaluates the global rate invariant against current SQL
   * state. No stale snapshot, callback replay, or external side effect is involved.
   * Guard expected_revision is a batch-local decision: 0 denied, 1 admitted, -1 corrupt.
   * Existing entity/history triggers still fence generic snapshot transactions.
   * `bind` joins the same decision: an admitted challenge also names its ceremony on the
   * session and stores the session's hosted flow, so neither exists without the other.
   */
  async saveChallenge(id: string, challenge: Challenge, previousId: string | undefined, now: number, bind?: CeremonyBind): Promise<{ session: boolean; flow: boolean }> {
    validateRecord("challenges", id, challenge);
    if (bind?.flow) validateRecord("challenges", bind.flow.id, bind.flow.challenge);
    if (!Number.isSafeInteger(now) || now < 0) throw new StorageUnavailableError();
    const attempt = crypto.randomUUID();
    const admitted = "EXISTS(SELECT 1 FROM id_write_guards WHERE attempt_id=? AND expected_revision=1)";
    const statements = [
      // Schema-2 guard always validates canonical origin/schema/readiness. Empty
      // dependencies are safe here because all decisions are made inside the batch.
      this.db.prepare("INSERT INTO id_write_guards(attempt_id,expected_revision,expected_origin,expected_schema_version,dependencies) VALUES(?,?,?,?,?)").bind(attempt, 0, this.origin, D1_SCHEMA_VERSION, "[]"),
      this.db.prepare(`UPDATE id_write_guards SET expected_revision=(SELECT CASE
        WHEN EXISTS(SELECT 1 FROM json_each(requests) WHERE type NOT IN ('integer','real') OR value<0 OR value>1.7976931348623157e308) THEN -1
        WHEN (SELECT count(*) FROM json_each(requests) WHERE value>?)<60 THEN 1 ELSE 0 END
        FROM id_metadata WHERE id=1) WHERE attempt_id=?`).bind(now - 60000, attempt),
      this.db.prepare(`DELETE FROM id_challenges WHERE ${admitted} AND (id=? OR id IN (SELECT id FROM id_challenges WHERE json_extract(data,'$.expires')<=? LIMIT 100))`).bind(attempt, previousId ?? "", now),
      this.db.prepare(`DELETE FROM id_sessions WHERE ${admitted} AND id IN (SELECT id FROM id_sessions WHERE json_extract(data,'$.expires')<=? LIMIT 100)`).bind(attempt, now),
      this.db.prepare(`UPDATE id_metadata SET requests=json_insert((SELECT json_group_array(value) FROM json_each(requests) WHERE value>?), '$[#]', ?),revision=revision+1 WHERE id=1 AND ${admitted} RETURNING id`).bind(now - 60000, now, attempt),
      this.db.prepare(`INSERT INTO id_challenges(id,data) SELECT ?,? WHERE ${admitted} RETURNING id`).bind(id, JSON.stringify(encodeFinancialRecord("challenges", id, challenge, this.origin)), attempt),
      ...(bind ? [this.db.prepare(`UPDATE id_sessions SET data=json_set(data,'$.ceremony',?) WHERE id=? AND ${admitted} RETURNING id`).bind(bind.ceremony, bind.sessionId, attempt)] : []),
      ...(bind?.flow ? [this.db.prepare(`INSERT INTO id_challenges(id,data) SELECT ?,? WHERE ${admitted} AND EXISTS(SELECT 1 FROM id_sessions WHERE id=?) RETURNING id`).bind(bind.flow.id, JSON.stringify(encodeFinancialRecord("challenges", bind.flow.id, bind.flow.challenge, this.origin)), attempt, bind.sessionId)] : []),
      // Transaction snapshots read all of id_versions, where every deleted quote, ceremony, flow
      // and session leaves a tombstone. Their ids are random and never recur, so such a tombstone
      // only fences a transaction already holding it, which then conflicts and retries.
      this.db.prepare(`DELETE FROM id_versions WHERE ${admitted} AND rowid IN (SELECT v.rowid FROM id_versions v WHERE v.record_id<>'' AND ((v.collection='challenges' AND NOT EXISTS(SELECT 1 FROM id_challenges c WHERE c.id=v.record_id)) OR (v.collection='sessions' AND NOT EXISTS(SELECT 1 FROM id_sessions s WHERE s.id=v.record_id))) LIMIT 1000)`).bind(attempt),
      this.db.prepare("DELETE FROM id_write_guards WHERE attempt_id=? RETURNING expected_revision").bind(attempt),
    ];
    this.context.reserveStatements(statements.length, false);
    let decision: number, stored = { session: false, flow: false };
    try {
      const responses = await this.batch(statements);
      if (responses.length !== statements.length || responses.some(r => !r.success) || responses.at(-1)?.results.length !== 1) throw new StorageUnavailableError();
      decision = (responses.at(-1)!.results[0] as { expected_revision: number }).expected_revision;
      if (decision === 1 && (responses[4].results.length !== 1 || responses[5].results.length !== 1 || (responses[5].results[0] as {id:string}).id !== id)) throw new StorageUnavailableError();
      if (bind) stored = { session: responses[6].results.length === 1, flow: !!bind.flow && responses[7].results.length === 1 };
    } catch { throw new StorageUnavailableError(); } // Ambiguous outcomes are never replayed.
    if (decision === 0) throw new AppError(ErrorCode.TooManyAuthenticationRequestsTryAgainInAMinute);
    if (decision !== 1) throw new StorageUnavailableError();
    return stored;
  }
  /** Like `saveChallenge`: no stale snapshot or callback replay; triggers version both records. */
  async bindCeremony(sessionId: string, ceremony: string, flow?: { id: string; challenge: Challenge; ceremonyId: string }) {
    if (flow) validateRecord("challenges", flow.id, flow.challenge);
    const attempt = crypto.randomUUID();
    const statements = [
      this.db.prepare("INSERT INTO id_write_guards(attempt_id,expected_revision,expected_origin,expected_schema_version,dependencies) VALUES(?,?,?,?,?)").bind(attempt, 0, this.origin, D1_SCHEMA_VERSION, "[]"),
      this.db.prepare("UPDATE id_sessions SET data=json_set(data,'$.ceremony',?) WHERE id=? RETURNING id").bind(ceremony, sessionId),
      ...(flow ? [this.db.prepare("INSERT INTO id_challenges(id,data) SELECT ?,? WHERE EXISTS(SELECT 1 FROM id_sessions WHERE id=?) AND EXISTS(SELECT 1 FROM id_challenges WHERE id=?) RETURNING id").bind(flow.id, JSON.stringify(encodeFinancialRecord("challenges", flow.id, flow.challenge, this.origin)), sessionId, flow.ceremonyId)] : []),
      this.db.prepare("UPDATE id_metadata SET revision=revision+1 WHERE id=1 RETURNING id"),
      this.db.prepare("DELETE FROM id_write_guards WHERE attempt_id=?").bind(attempt),
    ];
    this.context.reserveStatements(statements.length, false);
    try {
      const responses = await this.batch(statements);
      if (responses.length !== statements.length || responses.some(r => !r.success) || responses.at(-2)?.results.length !== 1 || responses.at(-1)?.meta.changes !== 1) throw new StorageUnavailableError();
      return { session: responses[1].results.length === 1, flow: !!flow && responses[2].results.length === 1 };
    } catch { throw new StorageUnavailableError(); } // Ambiguous outcomes are never replayed.
  }
  private async snapshot(versions = true) {
    this.context.reserveStatements(1, true);
    try {
      const results = await this.batch([this.db.prepare(snapshotSql(versions))]);
      if (results.length !== 1) throw new StorageUnavailableError();
      return decodeCombinedSnapshot(results[0], this.origin);
    } catch { throw new StorageUnavailableError(); }
  }
  async read<T>(fn: (state: State) => T): Promise<T> {
    const { state } = await this.snapshot(false);
    return synchronous(fn(state));
  }
  async transaction<T>(fn: (state: State) => T): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { state, revision, versions } = await this.snapshot();
      const before = structuredClone(state);
      // Business failures propagate unchanged and are never retried.
      const tracking = dependencies(state, versions);
      const result = tracking.unwrap(synchronous(fn(tracking.state)));
      let statements;
      try {
        const id = crypto.randomUUID();
        // Include every write even when a callback replaced a whole map or used a descriptor.
        for (const field of Object.keys(D1_ENTITY_TABLES) as (keyof typeof D1_ENTITY_TABLES)[]) {
          const previous = before[field] ?? {}, current = state[field] ?? {};
          for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
            if (JSON.stringify(previous[key as keyof typeof previous]) !== JSON.stringify(current[key as keyof typeof current])) tracking.mark(field, key);
          }
        }
        const requestsChanged = JSON.stringify(before.requests) !== JSON.stringify(state.requests);
        if (requestsChanged) tracking.mark("requests", "");
        statements = [
          this.db.prepare("INSERT INTO id_write_guards(attempt_id,expected_revision,expected_origin,expected_schema_version,dependencies) VALUES(?,?,?,?,?)").bind(id, revision, this.origin, D1_SCHEMA_VERSION, JSON.stringify(tracking.records())),
          ...changedRecords(this.db, before, state, this.origin),
          this.db.prepare(requestsChanged ? "UPDATE id_metadata SET requests=?,revision=revision+1 WHERE id=1 RETURNING id" : "UPDATE id_metadata SET revision=revision+1 WHERE id=1 RETURNING id").bind(...(requestsChanged ? [JSON.stringify(state.requests)] : [])),
          this.db.prepare("DELETE FROM id_write_guards WHERE attempt_id=?").bind(id),
        ];
      } catch { throw new StorageUnavailableError(); }
      this.context.reserveStatements(statements.length, false);
      try {
        const responses = await this.batch(statements);
        if (responses.length !== statements.length || responses.some(r => !r.success) || responses.at(-2)?.results.length !== 1 || responses.at(-1)?.meta.changes !== 1) throw new StorageUnavailableError();
        return result;
      } catch (error) {
        if (!revisionConflict(error)) throw new StorageUnavailableError();
        if (attempt === 2) throw new StorageConflictError();
      }
    }
    throw new StorageConflictError();
  }
}
