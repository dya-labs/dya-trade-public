import { AppError, ErrorCode } from "../domain/errors";

export function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

/** Returns null on overflow, cancelling before buffering more than the limit. */
export async function readRequestText(request: Request, limit: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new AppError(ErrorCode.InvalidRequest); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError(ErrorCode.InvalidRequest);
  return body as Record<string, unknown>;
}
