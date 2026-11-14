/** Shared by server and browser; contains no provider credentials. */
export class RateLimitError extends Error {
  constructor(readonly retryAt: number) {
    super("Balance updates delayed. Please retry shortly.");
    this.name = "RateLimitError";
  }
}
export function retryAtFromHeader(value: string | null, now = Date.now()): number {
  const seconds = value !== null && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const date = value ? Date.parse(value) : NaN;
  const deadline = Number.isFinite(seconds) ? now + seconds * 1000 : Number.isFinite(date) ? date : now + 30000;
  // Untrusted numeric headers can overflow after conversion to milliseconds.
  // Keep unsupported deadlines from permanently blocking shared request gates.
  return Math.max(now + 1000, Number.isFinite(deadline) && deadline <= 8.64e15 ? deadline : now + 30000);
}
