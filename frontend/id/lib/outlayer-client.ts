import { setupQuotePreviewSchema } from "@dya/wallet-contracts/src/domain/outlayer-quote";
import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { authenticationOptions, registrationOptions } from "@dya/wallet-contracts/src/http/schemas/account";

const setupSchema = z.object({ setup: z.object({ network: z.literal("mainnet"), name: z.string(), originalUnchanged: z.literal(true), owner: z.enum(["unchecked", "verified"]), checkedAt: z.number().optional(), controllerId: z.string(), blockers: z.array(z.string()), recovery: z.object({ status: z.enum(["needed", "prepared", "review-required"]), verifiedAt: z.number().optional(), authority: z.literal("full-owner"), installedOnChain: z.boolean() }).optional(), canProvision: z.literal(false) }) });
async function request<T>(route: string, schema: z.ZodType<T>, body?: unknown, accountId?: string) {
  const response = await fetch(`/api/near/outlayer/${route}${accountId ? `?account=${encodeURIComponent(accountId)}` : ""}`, { cache: "no-store", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  if (!response.ok && route.startsWith("send-policy/") && response.status !== 401) {
    const failure = await response.json().catch(() => null);
    const reference = z.uuid().safeParse(failure?.requestId);
    throw new Error(reference.success
      ? `The policy request failed. Reference ${reference.data}.`
      : "The policy request failed. Try again.");
  }
  if (!response.ok) throw new Error(response.status === 401 ? "Sign in to your existing DYA account, then return here." : "The check could not complete. Sign in and try again.");
  return schema.parse(await response.json());
}
export const readTradingSetup = (accountId?:string) => request("setup", setupSchema, undefined,accountId);
export const prepareOwnerCheck = (accountId?:string) => request("owner/prepare", z.object({ options: authenticationOptions }), {},accountId);
export const verifyOwnerCheck = (assertion: AuthenticationResponseJSON,accountId?:string) => request("owner/verify", setupSchema, assertion,accountId);

export const readSetupQuote = (asset: "USDC" | "NEAR") => request("quote/preview", z.object({ quote: setupQuotePreviewSchema }), { asset });

export const prepareSetupQuote = (asset: "USDC" | "NEAR",accountId?:string) => request("quote/prepare", z.object({ quote: setupQuotePreviewSchema }), { asset },accountId);

const ceremonyOptions = z.object({options: authenticationOptions});
export const prepareTradingRecovery = () => request("recovery/prepare", ceremonyOptions, {});
export const authorizeTradingRecovery = (assertion: AuthenticationResponseJSON) => request("recovery/authorize", z.object({options: registrationOptions}), assertion);
export const registerTradingRecovery = (credential: import("@simplewebauthn/browser").RegistrationResponseJSON) => request("recovery/register", ceremonyOptions, credential);
export const testTradingRecovery = (assertion: AuthenticationResponseJSON) => request("recovery/test", z.object({ recovery: z.object({ status: z.literal("prepared"), authority: z.literal("full-owner"), installedOnChain: z.literal(false) }) }), assertion);

export const createTradingAccount = (requestId:string,name:string,paymentAsset:'USDC'|'NEAR'='USDC') => request("accounts/create", z.object({account:z.object({id:z.string().uuid(),name:z.string(),resumed:z.boolean().optional()})}), {requestId,name,paymentAsset});

export const resumeTradingAccount = () => request("accounts/resume", z.object({account:z.object({id:z.string(),name:z.string()}).nullable()}), {});


export { readTradingTokenBalances, readTradingActivity } from "@dya/wallet-ui/lib/near/http/trading-wallet-client";

const sendPolicyPhase = z.object({
  allowedAssets: z.array(z.string()).optional(),
  pendingAssets: z.array(z.string()).optional(),
  sendEnabled: z.boolean().optional(),
  canUnlockTradingTest: z.boolean().optional(),
  unlockedTradingTest: z.boolean().optional(),
  pendingUnlockedTradingTest: z.boolean().optional(),
  tradeApprovalExclusions: z.boolean().optional(),
  pendingTradeApprovalExclusions: z.boolean().optional(),
  tradingEnabled: z.boolean().optional(),
  pendingTradingEnabled: z.boolean().optional(),
  pendingEnabled: z.boolean().optional(),
  phase: z.enum(["disabled", "proposed", "voted", "submitted", "confirmed", "failed"]),
  transactionHash: z.string().optional(),
});
const policyOptions = z.object({ options: authenticationOptions });

export const readSendPolicy = (walletId: string) => request("send-policy/status", sendPolicyPhase, {}, walletId);
export const prepareSendPolicyVote = (walletId: string, enabled?: boolean, allowedAssets?: string[], tradingEnabled?: boolean, excludeTradeApproval?: true, unlockedTradingTest?: true) => request("send-policy/vote-options", z.union([policyOptions, z.object({ phase: z.literal("voted") })]), { enabled, allowedAssets, tradingEnabled, excludeTradeApproval, unlockedTradingTest }, walletId);
export const approveSendPolicyVote = (walletId: string, assertion: AuthenticationResponseJSON) =>
  request("send-policy/vote", sendPolicyPhase, assertion, walletId);
export const prepareSendPolicyFiling = (walletId: string) => request("send-policy/execution-options",
  z.union([policyOptions.extend({ storageYoctoNear: z.string() }), z.object({ phase: z.literal("voted") })]), {}, walletId);
export const fileSendPolicy = (walletId: string, assertion: AuthenticationResponseJSON) =>
  request("send-policy/execute", sendPolicyPhase, assertion, walletId);
export const resendSendPolicyFiling = (walletId: string) =>
  request("send-policy/rebroadcast", sendPolicyPhase, {}, walletId);

export { estimateTradingWithdrawal, readTradingWithdrawal, prepareTradingWithdrawalApproval, approveTradingWithdrawal } from "@dya/wallet-ui/lib/near/http/trading-wallet-client";

export function reviewTradingInternalSend(walletId: string, destination: string, rawAmount: string, assetId: string) {
  return request("send-policy/internal-review", z.object({ id: z.uuid(), deadline: z.iso.datetime({ offset: true }) }), { destination, rawAmount, assetId }, walletId);
}

export function readTradingInternalAssets(walletId: string) {
  return request("send-policy/internal-assets", z.object({
    reason: z.enum(["policy", "asset"]).optional(),
    assets: z.array(z.object({ assetId: z.string(), symbol: z.string(), blockchain: z.string(), decimals: z.number().int().min(0).max(38) })),
  }), {}, walletId);
}

const depositIntent = z.object({ intent_id: z.string(), deposit_address: z.string(), expires_at: z.string() });
const depositStatus = z.object({ status: z.enum(["pending", "bridging", "success", "failed", "expired"]) });
/** A Base USDC deposit address for the Trading wallet; `rawAmount` is in USDC's 6-decimal units. */
export async function createTradingDeposit(walletId: string, rawAmount: string) {
  const response = await fetch(`/api/near/outlayer/deposit?account=${encodeURIComponent(walletId)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: rawAmount }),
  });
  if (!response.ok) throw new Error("Couldn’t create a deposit address. Try again.");
  return depositIntent.parse(await response.json());
}
export async function readTradingDepositStatus(walletId: string, id: string, signal?: AbortSignal) {
  const response = await fetch(`/api/near/outlayer/deposit-status?${new URLSearchParams({ account: walletId, id })}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Deposit status unavailable.");
  return depositStatus.parse(await response.json()).status;
}
