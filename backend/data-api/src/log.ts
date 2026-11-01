export type LogLevel = "info" | "warn" | "error";

/**
 * One JSON object per line: info on stdout, warn/error on stderr. Rotation and shipping belong
 * to the container runtime's logging driver. Never pass secrets in `fields`.
 */
export function log(event: string, fields: object = {}, level: LogLevel = "info"): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  if (level === "info") console.log(line);
  else console.error(line);
}
