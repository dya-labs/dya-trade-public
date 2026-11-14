import { timingSafeEqual } from "node:crypto";
import { getDeploymentConfig } from "../deployment/config";

export function walletClientOrigin() {
  const wallet = getDeploymentConfig();
  const client = new URL(process.env.DYA_TERMINAL_ORIGIN || "http://localhost:3100");
  if (client.origin !== (process.env.DYA_TERMINAL_ORIGIN || "http://localhost:3100") ||
      (wallet.hosted && client.protocol !== "https:")) throw new Error("DYA_TERMINAL_ORIGIN must be a fixed origin");
  return client.origin;
}

export function bridgeConfig() {
  const wallet = getDeploymentConfig();
  const clientOrigin = walletClientOrigin();
  const secret = process.env.DYA_SERVICE_SECRET || (!wallet.hosted ? "dya-local-service-development-only" : "");
  if (!secret || (wallet.hosted && secret.length < 32)) throw new Error("DYA_SERVICE_SECRET is required for hosted wallet integration");
  return { wallet, clientOrigin, callback: `${clientOrigin}/api/wallet/callback`, secret };
}
export function checkServiceSecret(value: string | null) {
  const expected = Buffer.from(bridgeConfig().secret), actual = Buffer.from(value || "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
