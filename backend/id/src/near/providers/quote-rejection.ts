/** Provider error text is untrusted and may echo request data. Never log the body. */
export function quoteRejection(payload: unknown, sensitive: readonly string[] = []) {
  const row = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const clean = (value: unknown) => {
    if (typeof value !== "string") return undefined;
    // Inspect only a bounded diagnostic field; discard structured payload echoes.
    let text = value.slice(0, 2048);
    for (const secret of sensitive) if (secret) text = text.split(secret).join("[redacted]");
    if (/[{}\[\]]/.test(text.replaceAll("[redacted]", ""))) return "Provider returned a structured error; details omitted";
    return text.replace(/https?:\/\/\S+/gi, "[url]")
      .replace(/\b[a-z0-9._-]+\.(?:near|tg)\b/gi, "[account]")
      .replace(/\b[A-Za-z0-9_./+=:-]{32,}\b/g, "[identifier]")
      .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300);
  };
  // 1Click support traces a rejection by its correlation id; it carries no request data.
  const correlationId = typeof row.correlationId === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.correlationId) ? row.correlationId : undefined;
  return { providerCode: clean(row.code), reason: clean(row.message) ?? "No textual rejection reason returned", correlationId };
}

/** Only explicitly recognized provider copy becomes a user-facing reason. */
export function isNoLiquidityRejection(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const message = (payload as Record<string, unknown>).message;
  return typeof message === "string" && /^no liquidity available\.?$/i.test(message.trim());
}
