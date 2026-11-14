export const READ_INSIGHTS_KEY = "nervana:read-insights";

export function unreadInsightIds(storage: Pick<Storage, "getItem">, ids: string[]): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(READ_INSIGHTS_KEY) ?? "[]");
    const read = new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
    return ids.filter(id => !read.has(id));
  } catch {
    return ids;
  }
}

// Persist IDs rather than a timestamp so late-arriving records are still unread.
// Call with the bounded current history; evicted records need not be retained.
export function markInsightsRead(storage: Pick<Storage, "setItem">, ids: string[]) {
  storage.setItem(READ_INSIGHTS_KEY, JSON.stringify(ids));
}
