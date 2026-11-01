import { isIP } from "node:net";

/** Only configure a header when the reverse proxy strips untrusted client values. */
export function clientIp(request: Request, peer: string | undefined, configuredHeader: string | undefined): string {
  const candidate = configuredHeader ? request.headers.get(configuredHeader)?.trim() : peer;
  if (!candidate || !isIP(candidate)) throw new Error("Missing or invalid client IP");
  return candidate.startsWith("::ffff:") && isIP(candidate.slice(7)) === 4 ? candidate.slice(7) : candidate.toLowerCase();
}
