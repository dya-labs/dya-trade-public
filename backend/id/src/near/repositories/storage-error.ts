/** Runtime-neutral errors. Driver causes and records never belong in responses/logs. */
export class StorageUnavailableError extends Error {
  readonly category: string = "ID_STORAGE_UNAVAILABLE";
  readonly status = 503;
  readonly retryAfter = "1";
  constructor() { super("Wallet storage is temporarily unavailable. Please try again."); }
}
export class StorageConflictError extends StorageUnavailableError {
  override readonly category = "ID_STORAGE_CONFLICT";
}
export class StorageBudgetExceededError extends StorageUnavailableError {
  override readonly category = "ID_STORAGE_BUDGET_EXCEEDED";
}
export class ConfidentialRefreshBusyError extends StorageUnavailableError {
  override readonly category = "ID_CONFIDENTIAL_REFRESH_BUSY";
  constructor() { super(); this.message = "Private access is refreshing. Please try again shortly."; }
}
