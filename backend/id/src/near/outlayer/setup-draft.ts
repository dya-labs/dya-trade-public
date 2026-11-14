import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { base58 } from "@scure/base";
import { z } from "zod";
import { encryptionKey } from "../services/confidential-sessions";
import { providerFetch } from "../providers/http";
import { accountFor, type StateStore } from "../repositories/store";
import type { Account } from "../repositories/store";
import type { OutlayerSetupDraft } from "../../../../../packages/wallet-contracts/src/domain/outlayer-setup";
import { ownerPlan } from "./owner";
import { verifyInitialPolicyWrite, verifyPolicyWrite } from "./policy-write";

export function nextSetupDraft(state: OutlayerSetupDraft, event: { type: "receipt"; sealedRegistrationReceipt: string; registrationHttpStatus: number } | { type: "unknown"; registrationFailure?: OutlayerSetupDraft["registrationFailure"]; registrationHttpStatus?: number } | { type: "registered"; walletId: string; walletPublicKey: string; sealedApiKey: string } | { type: "policy"; encryptedPolicy: string; policyHash: string; policyKind?: "withdrawal-v1" | "transfer-v2" | "transfer-v3" }): OutlayerSetupDraft | undefined {
  if (state.phase === "registering" && event.type === "receipt") return { ...state, sealedRegistrationReceipt: event.sealedRegistrationReceipt, registrationHttpStatus: event.registrationHttpStatus };
  if (state.phase === "registering" && event.type === "unknown") return { ...state, phase: "registration-unknown", registrationFailure: event.registrationFailure, ...(event.registrationHttpStatus ? { registrationHttpStatus: event.registrationHttpStatus } : {}) };
  if ((state.phase === "registering" || (state.phase === "registration-unknown" && state.sealedRegistrationReceipt)) && event.type === "registered") return { ...state, walletId: event.walletId, walletPublicKey: event.walletPublicKey, sealedApiKey: event.sealedApiKey, phase: "registered" };
  if ((state.phase === "registered" || state.phase === "policy-ready") && event.type === "policy") return { ...state, encryptedPolicy: event.encryptedPolicy, policyHash: event.policyHash, ...(event.policyKind ? { policyKind: event.policyKind } : {}), phase: "policy-ready" };
}
function storageKey() { return createHmac("sha256", encryptionKey()).update("dya-outlayer-draft-key-v1").digest(); }
function binding(accountId: string, draft: OutlayerSetupDraft) { return `${accountId}:${draft.id}:${draft.controllerId}:${draft.publicKey}:${draft.credentialId}`; }
function seal(value: string, aad: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", storageKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64url");
}
function open(value: string, aad: string) {
  try {
    const bytes = Buffer.from(value, "base64url"), decipher = createDecipheriv("aes-256-gcm", storageKey(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString();
  } catch { throw new Error("Setup credential could not be restored. Setup needs review."); }
}
/** Bootstrap policy has no trading permissions. Binding it on chain and verifying
 * its enforcement are later, explicit activation gates; never fund this draft. */
export function bootstrapPolicy(walletId: string, controllerId: string) {
  return { wallet_id: walletId, rules: { transaction_types: [], allowed_tokens: [], addresses: { mode: "whitelist", list: [] } }, approval: { threshold: 1, locked: true, approvers: [{ id: controllerId }] },
    capabilities: Object.fromEntries(["raw_sign", "confidential", "sign_message", "payment_check", "swap", "cross_chain_withdraw", "limit_order", "evm_sign", "solana_sign", "intents_call"].map(name => [name, { allowed: false }])) };
}

export function withdrawalPolicy(walletId: string, controllerId: string) {
  const policy = bootstrapPolicy(walletId, controllerId);
  return {
    ...policy,
    rules: { ...policy.rules, transaction_types: ["confidential", "withdraw"], allowed_tokens: [baseUsdc], addresses: { mode: "none", list: [] } },
    capabilities: {
      ...policy.capabilities,
      confidential: { allowed: true, requires_approval: true },
      cross_chain_withdraw: { allowed: true, requires_approval: true },
    },
  };
}

/** Explicit preparation action only; never called by GET or a dry estimate.
 * One registration attempt is durably recorded BEFORE the remote request. An
 * uncertain/crashed registration cannot be retried automatically. No mainnet tx. */
export async function prepareSetupDraft(store: StateStore, session: string, account: Account, fetcher: typeof fetch = fetch) {
  storageKey(); // Fail before registration if encrypted persistence is unavailable.
  const probeBinding = "dya-outlayer-crypto-preflight-v1";
  const probe = seal("preflight", probeBinding);
  if (open(probe, probeBinding) !== "preflight") throw new Error("Setup encryption is unavailable.");
  const controllerId = ownerPlan(account.publicKey!).controllerId;
  const attemptId = randomUUID();
  let draft = await store.transaction(s => {
    const current = accountFor(s, session);
    if (!current || current.id !== account.id || current.publicKey !== account.publicKey || current.credentialId !== account.credentialId) throw new Error("Setup account changed. Sign in again.");
    if (current.outlayerSetupDraft) {
      const existing = current.outlayerSetupDraft;
      if (existing.publicKey !== account.publicKey || existing.credentialId !== account.credentialId || existing.controllerId !== controllerId) throw new Error("Setup ownership changed. Manual review required.");
      return existing;
    }
    const initial: OutlayerSetupDraft = { id: attemptId, phase: "registering", controllerId, publicKey: account.publicKey!, credentialId: account.credentialId!, createdAt: Date.now() };
    current.outlayerSetupDraft = initial;
    return initial;
  });
  async function commit(next: OutlayerSetupDraft) {
    return store.transaction(s => {
      const current = accountFor(s, session);
      if (!current || current.id !== account.id || current.publicKey !== account.publicKey || current.credentialId !== account.credentialId || current.outlayerSetupDraft?.id !== draft.id || current.outlayerSetupDraft.phase !== draft.phase) throw new Error("Setup changed. Manual review required.");
      current.outlayerSetupDraft = next; return next;
    });
  }
  const created = draft.id === attemptId;
  if ((draft.phase === "registration-unknown" || (draft.phase === "registering" && !created)) && !draft.sealedRegistrationReceipt) throw new Error("Wallet registration is unconfirmed. Do not retry; setup needs review.");
  if (draft.phase === "registering" || draft.phase === "registration-unknown") {
    let failure: OutlayerSetupDraft["registrationFailure"] = "transport";
    let httpStatus = draft.registrationHttpStatus;
    try {
      if (!draft.sealedRegistrationReceipt) {
        const response = await providerFetch(fetcher, "https://api.outlayer.ai/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        httpStatus = response.status;
        const text = await response.text();
        if (text.length > 65_536) throw new Error("Registration response exceeds the receipt limit.");
        failure = "receipt-checkpoint";
        draft = await commit(nextSetupDraft(draft, { type: "receipt", sealedRegistrationReceipt: seal(text, binding(account.id, draft)), registrationHttpStatus: response.status })!);
      }
      failure = "provider-rejected";
      if (httpStatus !== 200) throw new Error("Provider did not confirm registration.");
      failure = "response-validation";
      const raw = JSON.parse(open(draft.sealedRegistrationReceipt!, binding(account.id, draft)));
      const registration = z.object({ api_key: z.string().startsWith("wk_"), wallet_id: z.string().uuid(), near_account_id: z.string().regex(/^[0-9a-f]{64}$/) }).parse(raw);
      failure = "credential-checkpoint";
      draft = await commit(nextSetupDraft(draft, { type: "registered", walletId: registration.wallet_id, walletPublicKey: registration.near_account_id, sealedApiKey: seal(registration.api_key, binding(account.id, draft)) })!);
    } catch {
      // Never discard a one-time response or re-register after a lost result.
      if (draft.phase === "registering") await commit(nextSetupDraft(draft, { type: "unknown", registrationFailure: failure, registrationHttpStatus: httpStatus })!);
      console.warn("outlayer.registration.unconfirmed", { stage: failure, ...(httpStatus ? { httpStatus } : {}) });
      throw new Error("Wallet registration is unconfirmed. Setup needs review before retrying.");
    }
  }
  if (draft.phase === "policy-ready") return draft;
  if (draft.phase !== "registered") throw new Error("Setup registration is not ready.");
  const encrypted = await encryptWalletPolicy(account.id, draft, withdrawalPolicy(draft.walletId, draft.controllerId), fetcher);
  draft = await commit(nextSetupDraft(draft, { type: "policy", encryptedPolicy: encrypted.encrypted_base64, policyHash: encrypted.policy_hash, policyKind: "transfer-v3" })!);
  return draft;
}

export async function encryptWalletPolicy(
  accountId: string,
  draft: Extract<OutlayerSetupDraft, { phase: "registered" | "policy-ready" }>,
  policy: {
    rules: { transaction_types: string[]; allowed_tokens: string[]; addresses: { mode: string; list: string[] } };
    capabilities: Record<string, { allowed: boolean; requires_approval?: boolean }>;
  },
  fetcher: typeof fetch = fetch,
) {
  const apiKey = open(draft.sealedApiKey, binding(accountId, draft));
  const response = await providerFetch(fetcher, "https://api.outlayer.ai/wallet/v1/encrypt-policy", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(policy) });
  if (!response.ok) throw new Error("Policy preparation is unavailable. Your unfunded draft is preserved.");
  const encrypted = z.object({ encrypted_base64: z.string().min(4).max(4096).refine(value => Buffer.from(value, "base64").toString("base64") === value), wallet_pubkey: z.string(), policy_hash: z.string().regex(/^[0-9a-f]{64}$/) }).parse(await response.json());
  const keyText = encrypted.wallet_pubkey.replace(/^ed25519:/, "");
  // Mainnet currently returns the wallet UUID in this historically named field.
  // Older responses use the Ed25519 key. Bind either form to registration;
  // never substitute an arbitrary response identifier for the chain storage key.
  if (encrypted.wallet_pubkey !== draft.walletId) {
    let keyHex: string;
    try { keyHex = /^[0-9a-f]{64}$/.test(keyText) ? keyText : Buffer.from(base58.decode(keyText)).toString("hex"); }
    catch { throw new Error("Prepared policy wallet does not match registration."); }
    if (keyHex !== draft.walletPublicKey) throw new Error("Prepared policy wallet does not match registration.");
  }
  return encrypted;
}

/** Explicit unfunded activation preflight. Does not broadcast the returned write. */
export async function readTradingPolicy(accountId: string, draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>) {
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const response = await providerFetch(fetch, "https://api.outlayer.ai/wallet/v1/policy", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error("OutLayer policy unavailable.");
  const schema = z.looseObject({
    rules: z.looseObject({
      allowed_tokens: z.array(z.string()),
      transaction_types: z.array(z.string()),
      addresses: z.looseObject({ mode: z.string(), list: z.array(z.string()) }),
    }),
    approval: z.looseObject({ locked: z.boolean() }),
    capabilities: z.record(z.string(), z.looseObject({ allowed: z.boolean(), requires_approval: z.boolean().optional() })),
  });
  const body = await response.json();
  const candidate = typeof body.policy === "object" && body.policy !== null ? body.policy : body;
  const { rules, approval, capabilities } = schema.parse(candidate);
  return { rules, approval, capabilities };
}

export async function prepareInitialPolicyWrite(accountId: string, draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>, fetcher: typeof fetch = fetch, now = Date.now()) {
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const response = await providerFetch(fetcher, "https://api.outlayer.ai/wallet/v1/sign-policy", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ encrypted_data: draft.encryptedPolicy, caller: draft.controllerId }) });
  if (!response.ok) throw new Error("Initial policy signing is unavailable. No transaction was submitted.");
  return verifyInitialPolicyWrite(await response.json(), { walletPublicKey: draft.walletPublicKey, controllerId: draft.controllerId, encryptedPolicy: draft.encryptedPolicy, policyHash: draft.policyHash }, now);
}

const confidentialBalanceSchema = z.object({
  account_id: z.string(),
  balances: z.array(z.object({ token: z.string().min(1), balance: z.string().regex(/^(0|[1-9][0-9]{0,38})$/) })),
});

export async function readOutlayerTradingBalances(accountId: string, draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>, fetcher: typeof fetch = fetch) {
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const response = await providerFetch(fetcher, "https://api.outlayer.ai/wallet/v1/confidential/balance", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error("Trading balances unavailable.");
  const result = confidentialBalanceSchema.parse(await response.json());
  if (result.account_id !== draft.walletPublicKey) throw new Error("Trading balance account mismatch.");
  return result.balances;
}

const activitySchema = z.object({
  requests: z.array(z.object({
    request_id: z.string().min(1),
    type: z.string(),
    status: z.string(),
    created_at: z.iso.datetime({ offset: true }),
  })),
});

export async function readOutlayerTradingActivity(accountId: string, draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>, fetcher: typeof fetch = fetch, { includeAll = false } = {}) {
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const result = await providerFetch(fetcher, "https://api.outlayer.ai/wallet/v1/requests", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!result.ok) throw new Error("Trading activity unavailable.");
  const { requests } = activitySchema.parse(await result.json());
  return requests.filter(item => includeAll || ["transfer", "withdraw", "deposit", "swap"].includes(item.type))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export const nearUsdc = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const baseUsdc = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const depositIntent = z.object({
  intent_id: z.string().min(1),
  deposit_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(value => !/^0x0{40}$/.test(value)),
  amount: z.string(),
  expires_at: z.iso.datetime({ offset: true }),
});

export async function tradingDeposit(accountId: string, draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>, input: { amount: string } | { id: string }) {
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const headers = { Authorization: `Bearer ${key}` };
  if ("id" in input) {
    const result = await providerFetch(fetch, `https://api.outlayer.ai/wallet/v1/deposit-status?id=${encodeURIComponent(input.id)}`, { headers });
    if (!result.ok) throw new Error("Deposit status unavailable.");
    const status = z.object({
      intent_id: z.literal(input.id),
      status: z.enum(["pending", "bridging", "success", "failed", "expired"]),
    }).parse(await result.json());
    return status;
  }
  const amount = z.string().regex(/^[1-9][0-9]{6,17}$/).parse(input.amount);
  const result = await providerFetch(fetch, "https://api.outlayer.ai/wallet/v1/confidential/deposit/cross-chain", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ source_asset: baseUsdc, amount }),
  });
  if (!result.ok) {
    console.warn("OutLayer deposit address request failed", { status: result.status });
    throw new Error("Deposit address unavailable.");
  }
  const intent = depositIntent.parse(await result.json());
  if (intent.amount !== amount || Date.parse(intent.expires_at) <= Date.now()) throw new Error("Invalid deposit instructions.");
  return intent;
}

export async function proposeLockedPolicyUpdate(
  accountId: string,
  draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>,
  encryptedPolicy: string,
  fetcher: typeof fetch = fetch,
  locked = true,
) {
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const response = await providerFetch(fetcher, "https://api.outlayer.ai/wallet/v1/sign-policy", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ encrypted_data: encryptedPolicy, caller: draft.controllerId, ...(locked ? {} : { locked: false }) }),
  });
  if (!response.ok) throw new Error("OutLayer could not propose the policy update.");
  return z.object({
    status: z.literal("pending_approval"),
    approval_id: z.uuid(),
    request_id: z.uuid(),
  }).parse(await response.json());
}

export async function signUnlockedAssetPolicy(
  accountId: string,
  draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>,
  encryptedPolicy: string,
) {
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const result = await providerFetch(fetch, "https://api.outlayer.ai/wallet/v1/sign-policy", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ encrypted_data: encryptedPolicy, caller: draft.controllerId, locked: false }),
  });
  if (!result.ok) throw new Error("OutLayer could not authorize the asset policy.");
  return z.record(z.string(), z.unknown()).parse(await result.json());
}

export class PolicyProposalEnded extends Error {}

export async function readApprovedPolicyWrite(
  accountId: string,
  draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>,
  expected: { requestId: string; version: number; encryptedPolicy: string; policyHash: string; unlockedTradingTest?: true },
  fetcher: typeof fetch = fetch,
) {
  const requestId = z.uuid().parse(expected.requestId);
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const response = await providerFetch(fetcher, `https://api.outlayer.ai/wallet/v1/requests/${requestId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error("OutLayer policy approval status unavailable.");
  const parsed = z.object({
    request_id: z.literal(requestId),
    status: z.string(),
    result: z.unknown().optional(),
  }).safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid OutLayer policy write response.");
  const result = parsed.data;
  if (["pending_approval", "approved", "processing"].includes(result.status)) return null;
  if (["expired", "rejected", "failed"].includes(result.status)) throw new PolicyProposalEnded("OutLayer policy approval ended.");
  if (result.status !== "success") throw new Error("OutLayer policy approval did not complete.");
  const signed = z.object({
    encrypted_data: z.literal(expected.encryptedPolicy),
    caller: z.literal(draft.controllerId),
    wallet_signature: z.string(),
    public_key_hex: z.string(),
    version: z.number(),
    locked: z.boolean(),
    valid_until: z.number().int().positive().safe(),
  }).parse(result.result);
  if (signed.valid_until * 1000 <= Date.now() + 60_000) {
    throw new PolicyProposalEnded("OutLayer policy filing authorization expired.");
  }
  return verifyPolicyWrite({ ...signed, signature_hex: signed.wallet_signature, policy_hash: expected.policyHash }, {
    ...expected,
    locked: !expected.unlockedTradingTest,
    walletPublicKey: draft.walletPublicKey,
    controllerId: draft.controllerId,
  });
}

export async function quoteTradingWithdrawal(
  accountId: string,
  draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>,
  input: { recipient: string; rawAmount: string },
  fetcher: typeof fetch = fetch,
) {
  const recipient = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
    .refine(value => !/^0x0{40}$/.test(value)).parse(input.recipient);
  const amount = z.string().regex(/^[1-9][0-9]{0,37}$/).parse(input.rawAmount);
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const response = await providerFetch(fetcher, "https://api.outlayer.ai/wallet/v1/confidential/withdraw/dry-run", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ chain: "base", to: recipient, token: baseUsdc, amount }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error("Trading withdrawal quote unavailable.");
  const raw = z.string().regex(/^[1-9][0-9]{0,37}$/);
  const quote = z.object({
    amount_out: raw,
    min_amount_out: raw,
    deadline: z.iso.datetime({ offset: true }).nullish(),
    would_succeed: z.literal(true).optional(),
  }).parse(payload);
  // A dry run is an estimate. Execution obtains its own quote.
  const result = { ...quote, deadline: quote.deadline ?? new Date(Date.now() + 60_000).toISOString() };
  if (Date.parse(result.deadline) <= Date.now() ||
      BigInt(result.min_amount_out) > BigInt(result.amount_out) ||
      BigInt(result.amount_out) > BigInt(amount)) {
    throw new Error("Invalid Trading withdrawal quote.");
  }
  return result;
}

export async function readTradingWithdrawalStatus(
  accountId: string,
  draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>,
  id: string,
  fetcher: typeof fetch = fetch,
) {
  const requestId = z.uuid().parse(id);
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const response = await providerFetch(fetcher, `https://api.outlayer.ai/wallet/v1/requests/${requestId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error("Trading withdrawal status unavailable.");
  const result = z.object({
    request_id: z.literal(requestId),
    status: z.enum(["pending_approval", "approved", "pending_deposit", "processing", "success", "failed", "refunded", "rejected", "needs_review"]),
  }).parse(await response.json());
  switch (result.status) {
    case "success": return { state: "settled", terminal: true } as const;
    case "failed":
    case "refunded":
    case "rejected": return { state: "failed", terminal: true } as const;
    case "needs_review": return { state: "unknown", terminal: true } as const;
    case "pending_approval": return { state: "unknown", terminal: false } as const;
    default: return { state: "submitted", terminal: false } as const;
  }
}

/** The caller must durably record the idempotency key and reviewed terms first.
 * This expects a locked policy requiring the controller's vote for every send. */
export async function proposeTradingWithdrawal(
  accountId: string,
  draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>,
  input: { internal?: true; assetId?: string; recipient: string; rawAmount: string; idempotencyKey: string },
  fetcher: typeof fetch = fetch,
) {
  const to = z.string().regex(input.internal ? /^(?:0x[0-9a-fA-F]{40}|[0-9a-f]{64})$/ : /^0x[0-9a-fA-F]{40}$/)
    .refine(value => !/^0x0{40}$/.test(value)).parse(input.recipient);
  const amount = z.string().regex(/^[1-9][0-9]{0,37}$/).parse(input.rawAmount);
  const idempotencyKey = z.uuid().parse(input.idempotencyKey);
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const response = await providerFetch(fetcher, `https://api.outlayer.ai/wallet/v1/confidential/${input.internal ? "transfer" : "withdraw"}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ ...(input.internal ? {} : { chain: "base" }), to, token: input.assetId ?? baseUsdc, amount }),
  });
  if (!response.ok) throw new Error("Trading withdrawal proposal could not be confirmed.");
  const result = z.object({
    status: z.literal("pending_approval"),
    request_id: z.uuid(),
    approval_id: z.uuid().nullish(),
  }).parse(await response.json());
  if (result.approval_id) return { ...result, approval_id: result.approval_id };

  const pending = await providerFetch(fetcher, "https://api.outlayer.ai/wallet/v1/pending_approvals", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!pending.ok) throw new Error("Trading withdrawal approval unavailable.");
  const { approvals } = z.object({
    approvals: z.array(z.object({ request_id: z.uuid().nullish(), approval_id: z.uuid() })),
  }).parse(await pending.json());
  const matches = approvals.filter(approval => approval.request_id === result.request_id);
  if (matches.length !== 1) throw new Error("Trading withdrawal approval could not be identified.");
  return { ...result, approval_id: matches[0].approval_id };
}

export class TradingOrderRejected extends Error {}

export async function tradingOrderRequest(
  accountId: string,
  draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>,
  path: "confidential/swap" | "confidential/swap/quote" | "limit-orders",
  body: object,
  id: string,
) {
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const result = await providerFetch(fetch, `https://api.outlayer.ai/wallet/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Idempotency-Key": id },
    body: JSON.stringify(body),
  });
  if (!result.ok) {
    const payload: unknown = await result.json().catch(() => null);
    const parsed = z.object({ code: z.string().optional(), error: z.string().optional() }).safeParse(payload);
    const code = parsed.success ? parsed.data.code ?? parsed.data.error : undefined;
    const safeCode = code && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : undefined;
    console.warn("outlayer.trade.rejected", { path, status: result.status, code: safeCode });
    if (path === "limit-orders" && [400, 422].includes(result.status)) {
      if (safeCode === "insufficient_balance") throw new TradingOrderRejected("Insufficient Trading balance for this limit order.");
      if (safeCode === "amount_too_small" || safeCode === "order_too_small") {
        throw new TradingOrderRejected("Limit orders must be worth at least $0.10. Increase the order size.");
      }
      throw new TradingOrderRejected(`OutLayer rejected the limit order${safeCode ? ` (${safeCode})` : ""}. Check the order size and price.`);
    }
    throw new Error("OutLayer did not confirm the order. Check Trading activity before submitting again.");
  }
  if (path === "confidential/swap/quote") return z.object({ amount_out: z.string(), min_amount_out: z.string() }).parse(await result.json());
  return z.object({
    status: z.string().optional(), request_id: z.uuid().optional(), order_id: z.string().optional(),
  }).refine(value => !!(value.request_id || value.order_id)).parse(await result.json());
}

export async function readOutlayerOpenOrders(accountId: string, draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>) {
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const result = await providerFetch(fetch, "https://api.outlayer.ai/wallet/v1/limit-orders?open=true&limit=100", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!result.ok) throw new Error(`OutLayer returned HTTP ${result.status} for limit orders.`);
  const order = z.object({
    order_id: z.string(), base_asset: z.string(), quote_asset: z.string(),
    price: z.union([z.string(), z.number()]), side: z.enum(["buy", "sell"]),
    fill_status: z.string(), is_payout_status_final: z.boolean().optional(),
  });
  const parsed = z.union([z.object({ orders: z.array(order) }), z.array(order)]).safeParse(await result.json());
  if (!parsed.success) throw new Error("OutLayer returned an unrecognized limit order response.");
  const orders = Array.isArray(parsed.data) ? parsed.data : parsed.data.orders;
  const refreshed = await Promise.all(orders.map(async entry => {
    if (entry.fill_status.toLowerCase() !== "pending_cancel" || entry.is_payout_status_final) return entry;
    try {
      const status = await readOutlayerLimitOrderStatus(entry.order_id, { Authorization: `Bearer ${key}` });
      return { ...entry, ...status };
    } catch {
      return entry;
    }
  }));
  return refreshed.filter(entry => !entry.is_payout_status_final);
}

export async function cancelOutlayerLimitOrder(accountId: string, draft: Extract<OutlayerSetupDraft, { phase: "policy-ready" }>, orderId: string) {
  const key = open(draft.sealedApiKey, binding(accountId, draft));
  const url = `https://api.outlayer.ai/wallet/v1/limit-orders/${encodeURIComponent(orderId)}`;
  const headers = { Authorization: `Bearer ${key}` };
  const current = await readOutlayerLimitOrderStatus(orderId, headers);
  if (current.is_payout_status_final || !["open", "partially_filled", "awaiting_deposit"].includes(current.fill_status.toLowerCase())) return current;
  const result = await providerFetch(fetch, `${url}/cancel`, { method: "POST", headers });
  if (!result.ok) throw new Error("OutLayer did not confirm cancellation. Check the order status before retrying.");
  return readOutlayerLimitOrderStatus(orderId, headers);
}


async function readOutlayerLimitOrderStatus(orderId: string, headers: HeadersInit) {
  const result = await providerFetch(fetch, `https://api.outlayer.ai/wallet/v1/limit-orders/${encodeURIComponent(orderId)}`, { headers });
  if (!result.ok) throw new Error("Could not check Trading limit order status.");
  return z.object({ order_id: z.literal(orderId), fill_status: z.string(), is_payout_status_final: z.boolean() }).parse(await result.json());
}
