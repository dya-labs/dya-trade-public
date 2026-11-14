import { StorageBudgetExceededError, StorageUnavailableError } from "./storage-error";
export interface StorageRequestContext {
  reserveStatements(count: number, readOnly: boolean): void;
  /** `elapsedMs`: the batch's wall time from this Worker, network included. */
  observeBatch?(metadata: readonly StorageBatchMetadata[], failed?: boolean, elapsedMs?: number): void;
}
export interface StorageBatchMetadata { rows_read?: number; rows_written?: number; duration?: number; served_by_colo?: string; served_by_region?: string }
export class StatementBudget implements StorageRequestContext {
  readonly limit: number;
  used = 0;
  statements = 0;
  exhausted = false;
  successfulStatements = 0;
  failedBatches = 0;
  rowsRead = 0;
  rowsWritten = 0;
  sqlDurationMs = 0;
  batches = 0;
  batchMs = 0;
  /** Where D1 answered the last batch (its colo, else its region), as D1 reports it. */
  servedBy = "";
  constructor(profile: string = "free") {
    if (profile !== "free" && profile !== "paid") throw new StorageUnavailableError();
    this.limit = profile === "paid" ? 800 : 40;
  }
  reserveStatements(count: number, readOnly: boolean) {
    if (!Number.isSafeInteger(count) || count < 1) throw new StorageUnavailableError();
    const cost = count * (readOnly ? 3 : 1);
    if (this.exhausted || this.used + cost > this.limit) {
      this.exhausted = true;
      throw new StorageBudgetExceededError();
    }
    this.used += cost;
    this.statements += count;
  }
  observeBatch(metadata: readonly StorageBatchMetadata[], failed = false, elapsedMs = 0) {
    this.batches++;
    this.batchMs += elapsedMs;
    if (failed) { this.failedBatches++; return; }
    this.successfulStatements += metadata.length;
    const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
    for (const meta of metadata) {
      this.rowsRead += number(meta.rows_read);
      this.rowsWritten += number(meta.rows_written);
      this.sqlDurationMs += number(meta.duration);
      const location = meta.served_by_colo ?? meta.served_by_region;
      if (typeof location === "string" && /^[A-Za-z0-9-]{1,16}$/.test(location)) this.servedBy = location;
    }
  }
}
export function createStorageRequestContext(): StorageRequestContext {
  return new StatementBudget(process.env.DYA_ID_D1_QUERY_PROFILE ?? "free");
}
