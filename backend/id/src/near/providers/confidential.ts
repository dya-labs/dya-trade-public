import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { ConfidentialAccessRequired } from "../../../../../packages/wallet-contracts/src/domain/confidential-access-error";
import { z } from "zod";
import { ONE_CLICK_BASE, providerFetch } from "./http";
import type { SignedEvmIntent } from "./recovery";
import type { SignedWebAuthn } from "../auth/intents";
export const privateBalances = z.object({ balances: z.array(z.object({ tokenId: z.string(), available: z.string().regex(/^\d+$/), source: z.literal("private") })) });
const access = z.object({ accessToken: z.string().min(1), expiresIn: z.number().positive() });
const credentials = access.extend({ refreshToken: z.string().min(1), refreshExpiresIn: z.number().positive() });
export async function authenticateConfidential(signedData: SignedWebAuthn | SignedEvmIntent, fetcher = fetch) {
  const payload = JSON.parse(signedData.payload);
  if (!Array.isArray(payload.intents) || payload.intents.length !== 0) throw new Error("Authentication must not contain transfer intents.");
  const r = await providerFetch(fetcher, `${ONE_CLICK_BASE}/v0/auth/authenticate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signedData }) });
  if (!r.ok) throw new Error(`Confidential authentication rejected (${r.status}).`);
  return credentials.parse(await r.json());
}
export async function refreshConfidential(refreshToken: string, fetcher = fetch) {
  const r = await providerFetch(fetcher, `${ONE_CLICK_BASE}/v0/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) });
  if (r.status === 401 || r.status === 403) throw new ConfidentialAccessRequired("Confidential session expired. Unlock again.");
  if (!r.ok) throw new AppError(ErrorCode.PrivateAccessRefreshIsTemporarilyUnavailable);
  return access.parse(await r.json());
}
export async function readConfidentialBalances(accessToken: string, fetcher = fetch) {
  const r = await providerFetch(fetcher, `${ONE_CLICK_BASE}/v0/account/balances`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (r.status === 401 || r.status === 403) throw new ConfidentialAccessRequired();
  if (!r.ok) throw new Error(`Private balance access unavailable (${r.status}).`);
  return privateBalances.parse(await r.json());
}
