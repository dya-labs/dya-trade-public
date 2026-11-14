import { NextResponse } from "next/server";
import { StorageUnavailableError } from "../repositories/storage-error";
import { LocalRecoveryRestricted } from "../services/recovery-mode";
import { ConfidentialAccessRequired } from "../../../../../packages/wallet-contracts/src/domain/confidential-access-error";
import { RateLimitError } from "../../../../../packages/wallet-contracts/src/domain/rate-limit";
import { errorBody, logRequestError, requestIdOf, type ErrorBody } from "../../../../../packages/wallet-contracts/src/http/error-response";
import { isPublicError } from "../../../../../packages/wallet-contracts/src/domain/errors";

/**
 * The response for a failed ID request, and its log event. Reviewed errors keep their message;
 * anything else answers "Something went wrong" with the request ID that finds its details in
 * Workers Logs. `operation` must not contain bearer values (see `routePattern`).
 */
export function errorResponse(request: Request, operation: string, error: unknown): NextResponse {
  const requestId = requestIdOf(request);
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  let status: number, body: ErrorBody, expected = true;
  if (error instanceof StorageUnavailableError) {
    status = error.status; body = { error: error.message, code: error.category, requestId }; headers["Retry-After"] = error.retryAfter;
  } else if (error instanceof RateLimitError) {
    status = 429; body = { error: error.message, requestId }; headers["Retry-After"] = String(Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000)));
  } else if (error instanceof ConfidentialAccessRequired) {
    status = 401; body = { error: error.message, code: error.code, requestId };
  } else if (error instanceof LocalRecoveryRestricted) {
    status = 403; body = { error: error.message, requestId };
  } else {
    // 400 as before: most unreviewed throws are rejected client input (bad proofs, replays), not server faults.
    expected = isPublicError(error); status = 400; body = errorBody(error, requestId);
  }
  logRequestError({ requestId, operation, status, error, expected });
  return NextResponse.json(body, { status, headers });
}

export function relayWalletResponse(body: unknown, result: Response) {
  return NextResponse.json(body, { status: result.status, headers: {
    "Cache-Control": "no-store", ...(result.headers.has("Server-Timing") ? { "Server-Timing": result.headers.get("Server-Timing")! } : {}), ...(result.headers.has("Retry-After") ? { "Retry-After": result.headers.get("Retry-After")! } : {}),
  } });
}
