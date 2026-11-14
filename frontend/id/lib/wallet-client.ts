import { z } from "zod";
import { authenticationOptions, registrationOptions } from "../../../packages/wallet-contracts/src/http/schemas/account";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";
/** A rejected ID API request; the message is the server's user-facing reason. */
export class WalletRequestError extends Error {}
async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const result: unknown = await response.json();
  if (!response.ok) { const failure = z.object({ error: z.string() }).safeParse(result); throw new WalletRequestError(failure.success ? failure.data.error : "Wallet request failed"); }
  return schema.parse(result);
}
const ok = z.object({ ok: z.literal(true) });
export const getRegistrationOptions = (name: string) => post("/api/near/auth/register/options", { name }, registrationOptions);
export const getLoginOptions = (credentialId?: string) => post("/api/near/auth/login/options", credentialId ? { credentialId } : {}, authenticationOptions);
export const registerPasskey = (assertion: RegistrationResponseJSON) => post("/api/near/auth/register/verify", assertion, ok);
export const loginPasskey = (assertion: AuthenticationResponseJSON) => post("/api/near/auth/login/verify", assertion, ok);
export const finishConnection = (id: string) => post(`/api/flow/${id}`, { action: "connect" }, z.object({ code: z.string(), callback: z.url(), clientOrigin: z.url() }));
export const finishApproval = (id: string, assertion: AuthenticationResponseJSON | RegistrationResponseJSON) => post(`/api/flow/${id}`, { action: "approve", assertion }, z.object({ status: z.number().int(), body: z.unknown(), callback: z.url(), clientOrigin: z.url() }));
