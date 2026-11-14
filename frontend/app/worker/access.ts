import { createHash, timingSafeEqual } from "node:crypto";
import { getDeploymentConfig, type DeploymentConfig } from "./config";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** An outer tester gate. Passkeys and account ownership still authorize account operations. */
export function checkInternalAccess(request: Request, config?: DeploymentConfig): Response | null {
  let deployment: DeploymentConfig;
  try { deployment = config ?? getDeploymentConfig(); }
  catch (error) {
    // Configuration errors contain validation guidance only; never log env values.
    console.error("Deployment configuration validation failed", error instanceof Error ? error.message : "Unknown configuration error");
    return Response.json({ error: "Internal deployment is not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (host !== new URL(deployment.origin).host)
    return Response.json({ error: "Use the configured terminal origin" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!deployment.password) return null;
  const authorization = request.headers.get("authorization") ?? "";
  const encoded = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization)?.[1];
  const actual = encoded && encoded.length < 4096 ? Buffer.from(encoded, "base64").toString("utf8") : "";
  if (timingSafeEqual(digest(actual), digest(`tester:${deployment.password}`))) return null;
  return new Response("Internal testing access required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Internal terminal", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}
