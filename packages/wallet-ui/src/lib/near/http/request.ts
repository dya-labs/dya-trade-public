import { ConfidentialAccessRequired } from "../domain/confidential-access-error";
import { RateLimitError, retryAtFromHeader } from "../domain/rate-limit";
import { z } from "zod";
import { AppError, ErrorCode, errorMessages, RemoteRequestError } from "../domain/errors";
export { RemoteRequestError } from "../domain/errors";

const errorResponse = z.object({ error: z.string().min(1), code: z.string().optional(), minimumUsd: z.string().regex(/^[0-9]{1,12}(\.[0-9]{1,12})?$/).optional() });

/** Transport only. Endpoint services own paths, bodies, and response schemas. No mutation retries. */
export async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown, signal?: AbortSignal): Promise<T> {
  const started = performance.now();
  const response = await fetch(`/api/near/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store", signal,
  });
  if (response.status === 429) throw new RateLimitError(retryAtFromHeader(response.headers.get("Retry-After")));
  let data: unknown;
  try { data = await response.json(); }
  catch (cause) {
    if (signal?.aborted) throw cause;
    throw new AppError(response.ok ? ErrorCode.InvalidApiResponse : ErrorCode.RequestFailed);
  }
  if (path === "live/preview" || path === "live/market/prepare") {
    const stages = (response.headers.get("Server-Timing") ?? "").split(",").flatMap(item => {
      const match = /^\s*(quote_(?:catalog|token_discovery|pair_access|balances|session|fees|preview|oneclick|executable|signing_payload|prepare|challenge|cache|total)|wallet_service);dur=([0-9]+(?:\.[0-9]+)?)\s*$/.exec(item);
      return match ? [[match[1], Number(match[2])]] : [];
    });
    console.debug("trading.quote.transport", JSON.stringify({ operation: path === "live/preview" ? "preview" : "prepare", requestMs: Math.round(performance.now() - started), status: response.status, ...Object.fromEntries(stages) }));
  }
  if (!response.ok) {
    const error = errorResponse.safeParse(data);
    if (error.success && error.data.code === "CONFIDENTIAL_ACCESS_REQUIRED") throw new ConfidentialAccessRequired(error.data.error);
    const code = z.enum(ErrorCode).safeParse(error.success ? error.data.code : undefined);
    throw new RemoteRequestError(error.success ? error.data.error : errorMessages[ErrorCode.RequestFailed](), code.success ? code.data : undefined, code.success && code.data === ErrorCode.LimitOrderAmountTooSmall && error.success ? error.data.minimumUsd : undefined);
  }
  const result = schema.safeParse(data);
  if (!result.success) throw new AppError(ErrorCode.InvalidApiResponse);
  return result.data;
}
