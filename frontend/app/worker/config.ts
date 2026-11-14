export interface DeploymentConfig {
  origin: string;
  rpId: string;
  hosted: boolean;
  secure: boolean;
  password?: string;
}

/** Never derive trust from request headers. */
export function getDeploymentConfig(env: Record<string, string | undefined> = process.env): DeploymentConfig {
  const url = new URL(env.APP_ORIGIN || "http://localhost:3100");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("APP_ORIGIN must be an origin without credentials, path, query, or fragment");
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const hosted = !local;
  if ((hosted && url.protocol !== "https:") || (!hosted && !["http:", "https:"].includes(url.protocol)))
    throw new Error("Hosted APP_ORIGIN must use HTTPS and a non-local hostname");
  // Use the exact hostname rather than a parent domain so credentials stay bound to this origin.
  if (env.PASSKEY_RP_ID && env.PASSKEY_RP_ID !== url.hostname)
    throw new Error("PASSKEY_RP_ID must match the APP_ORIGIN hostname");
  const password = env.INTERNAL_ACCESS_PASSWORD || undefined;
  return { origin: url.origin, rpId: url.hostname, hosted, secure: url.protocol === "https:", password };
}
