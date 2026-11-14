import { z } from "zod";
import { authenticationOptions, registrationOptions } from "../../../packages/wallet-contracts/src/http/schemas/account";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";

async function post<T>(route: string, body: unknown, schema: z.ZodType<T>) {
  const res = await fetch(`/api/near/recovery/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  let result: unknown;
  try { result = await res.json(); }
  catch { throw new Error("Recovery service returned an invalid response. Try again."); }
  if (!res.ok) { const failure = z.object({ error: z.string() }).safeParse(result); throw new Error(failure.success ? failure.data.error : "Recovery could not complete. Start again."); }
  const parsed = schema.safeParse(result);
  if (!parsed.success) throw new Error("Recovery service returned an invalid response. Try again.");
  return parsed.data;
}
const message = z.object({ message: z.string().min(1), expiresAt: z.number() });
const complete = z.object({ ok: z.literal(true), status: z.literal("local_test") });
export const recoveryClient = {
  authorize: (address: string, chainId: number) => post("authorize/options", { address, chainId }, authenticationOptions),
  approve: (assertion: AuthenticationResponseJSON) => post("authorize/verify", assertion, message),
  enroll: (signature: string) => post("enroll", { signature }, complete.extend({ recoveryId: z.string() })),
  register: (recoveryId: string, address: string, chainId: number) => post("register/options", { recoveryId, address, chainId }, registrationOptions),
  replacement: (assertion: RegistrationResponseJSON) => post("register/verify", assertion, message),
  recover: (signature: string) => post("complete", { signature }, complete),
};
export type RecoveryWallet = { address: string; chainId: number; sign: (message: string) => Promise<string> };
interface Eip1193Provider { request(input: { method: string; params?: unknown[] }): Promise<unknown> }
const walletAccounts = z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/));
function readWalletAccounts(value: unknown) {
  const result = walletAccounts.safeParse(value);
  if (!result.success) throw new Error("Unable to read your wallet account. Reconnect and try again.");
  return result.data;
}
export async function connectRecoveryWallet(): Promise<RecoveryWallet> {
  const provider = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  if (!provider) throw new Error("Open this page in a browser with an Ethereum wallet extension.");
  const accounts = readWalletAccounts(await provider.request({ method: "eth_requestAccounts" }));
  if (!accounts.length) throw new Error("Unable to read your wallet account. Reconnect and try again.");
  const address = accounts[0];
  const chain = await provider.request({ method: "eth_chainId" });
  if (typeof chain !== "string" || !/^0x[0-9a-fA-F]+$/.test(chain)) throw new Error("Unsupported wallet chain ID.");
  const chainId = Number.parseInt(chain, 16);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Unsupported wallet chain ID.");
  return { address, chainId, async sign(message) {
    const current = readWalletAccounts(await provider.request({ method: "eth_accounts" }));
    if (!current.some(a => a.toLowerCase() === address.toLowerCase()) || await provider.request({ method: "eth_chainId" }) !== chain) throw new Error("Wallet changed. Start again.");
    const encoded = Array.from(new TextEncoder().encode(message), b => b.toString(16).padStart(2, "0")).join("");
    const signature = await provider.request({ method: "personal_sign", params: [`0x${encoded}`, address] });
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("Your wallet returned an invalid signature. Try again.");
    return signature;
  } };
}

const providerStep = z.object({ phase: z.string(), accounts: z.array(z.object({ id: z.string(), label: z.string() })).optional(), message: z.string().optional(), options: z.unknown().optional(), expiresAt: z.number().optional(), pending: z.boolean().optional(), outcome: z.string().optional(), recoveryId: z.string().optional(), error: z.string().optional() });
export type ProviderRecoveryStep = z.infer<typeof providerStep>;
export const providerRecoveryClient = {
  discover: (address: string, chainId: number) => post("provider/discover/options", { address, chainId }, providerStep),
  select: (recoveryId: string) => post("provider/discover/select", { recoveryId }, providerStep),
  enroll: (address: string, chainId: number) => post("provider/enroll/options", { address, chainId }, providerStep),
  recover: (recoveryId: string, address: string, chainId: number) => post("provider/recover/options", { recoveryId, address, chainId }, providerStep),
  advance: (phase: string, proof: unknown) => {
    const routes: Record<string, string> = { recover_discover: "discover/proof", enroll_ownership: "enroll/proof", enroll_key: "enroll/submit", enroll_auth: "enroll/verify", recover_register: "recover/register", recover_resume: "recover/resume", recover_add: "recover/add", recover_test: "recover/test", recover_remove: "recover/remove", recover_finish: "recover/finish" };
    if (!routes[phase]) throw new Error("This recovery step needs a status check.");
    return post(`provider/${routes[phase]}`, proof, providerStep);
  },
  status: () => post("provider/status", {}, providerStep),
};
