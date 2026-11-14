import { AppError, isPublicError, LimitOrderAmountTooSmallError } from "../domain/errors";

export type ErrorBody = { error: string; code?: string; requestId: string; minimumUsd?: string };

/**
 * The request's Cloudflare Ray ID (also in Cloudflare's edge and firewall logs), or a random ID
 * where there is none (local runs).
 */
export function requestIdOf(request: Request): string {
  return request.headers.get("cf-ray") || crypto.randomUUID();
}

/** The only error body clients see: a reviewed catalog message with its code, or a generic message carrying the request ID. */
export function errorBody(error: unknown, requestId: string): ErrorBody {
  if (isPublicError(error)) return { error: error.message, code: error.code, requestId, ...(error instanceof LimitOrderAmountTooSmallError ? { minimumUsd: error.minimumUsd } : {}) };
  return { error: `Something went wrong. Reference: ${requestId}`, requestId };
}

/** Route segments that aren't plain words (IDs, flow tokens) become `:id`, so logs never hold bearer values. */
export function routePattern(path: string): string {
  return path.split("/").filter(Boolean).map(segment => /^[a-z][a-z-]{0,40}$/.test(segment) ? segment : ":id").join("/");
}

/**
 * Logs a failed request as one structured event; Workers Logs indexes each field, so support can
 * search by `requestId`. Expected errors (reviewed messages, rate limits, storage retries) log at
 * warn without a stack. Never pass URLs, bodies or headers: flow IDs and sessions in them are
 * bearer credentials.
 */
export function logRequestError({ requestId, operation, status, error, expected = isPublicError(error) }: { requestId: string; operation: string; status: number; error: unknown; expected?: boolean }): void {
  // SyntaxErrors quote their input (`Unexpected token 's', "session=…" is not valid JSON`, `Cannot convert … to a BigInt`),
  // which here is client data; their stack repeats it, over several lines if it has newlines. Keep only the frames.
  const quotesInput = error instanceof SyntaxError;
  const entry = {
    event: "request.error", requestId, operation, status,
    code: error instanceof AppError ? error.code : undefined,
    name: error instanceof Error ? error.name : typeof error,
    message: quotesInput ? "Malformed input (redacted)" : error instanceof Error ? error.message : String(error),
    stack: !expected && error instanceof Error ? quotesInput ? error.stack?.split("\n").filter(line => /^\s+at /.test(line)).join("\n") : error.stack : undefined,
  };
  if (expected) console.warn(entry);
  else console.error(entry);
}

/** A 400 JSON error response for a failed request, logged with its request ID (see `errorBody`). */
export function jsonErrorResponse(request: Request, operation: string, error: unknown): Response {
  const requestId = requestIdOf(request), status = 400;
  logRequestError({ requestId, operation, status, error });
  return Response.json(errorBody(error, requestId), { status, headers: { "Cache-Control": "no-store" } });
}
