/** A slower request must not overwrite a result committed since it began. */
export function canReconcile(current: { updatedAt: number }, observed: { updatedAt: number }) {
  return current.updatedAt === observed.updatedAt;
}
export function nextRevision(previous: number, now = Date.now()) {
  return Math.max(now, previous + 1);
}
export function mergeHashes(previous: string[] | undefined, incoming: string[] | undefined) {
  if (!previous && !incoming) return undefined;
  return [...new Set([...(previous ?? []), ...(incoming ?? [])])];
}
export function operationState(current: string, status: string) {
  if (current === "settled" || current === "failed") return current;
  if (status === "SUCCESS") return "settled";
  if (["REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"].includes(status)) return "failed";
  return current;
}
export function isTerminalDeposit(status: string) {
  return ["SUCCESS", "FAILED", "REFUNDED", "INCOMPLETE_DEPOSIT"].includes(status);
}
