/** Format a deadline against the caller's clock; renderers own refresh cadence. */
export function formatCountdown(deadline: number, now: number): { text: string; description: string } {
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return { text: "—", description: "Time unavailable" };
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor(seconds / 60);
  if (days > 0) {
    const remainingHours = hours % 24;
    return {
      text: `${days}d ${remainingHours}h`,
      description: `${days} ${days === 1 ? "day" : "days"} ${remainingHours} ${remainingHours === 1 ? "hour" : "hours"}`,
    };
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return {
      text: `${hours}h ${remainingMinutes}m`,
      description: `${hours} ${hours === 1 ? "hour" : "hours"} ${remainingMinutes} ${remainingMinutes === 1 ? "minute" : "minutes"}`,
    };
  }
  const remainder = seconds % 60;
  return {
    text: `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`,
    description: `${minutes} ${minutes === 1 ? "minute" : "minutes"} ${remainder} ${remainder === 1 ? "second" : "seconds"}`,
  };
}
