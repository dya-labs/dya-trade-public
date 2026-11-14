/** Shared elapsed-time policy. Callers pass their clock to keep renders consistent. */
export function formatRelativeTime(timestamp: number, now: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(now)) return "-";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds >= 7 * 86400) {
    return date.toLocaleDateString(undefined, {
      month: "short", day: "numeric",
      ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" as const } : {}),
    });
  }
  if (seconds < 60) return "Just now";
  const units: [string, number][] = [["d", 86400], ["h", 3600], ["m", 60]];
  const [unit, size] = units.find(([, size]) => seconds >= size)!;
  return `${Math.floor(seconds / size)}${unit} ago`;
}
