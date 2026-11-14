import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { z } from "zod";
import { base58 } from "@scure/base";
import { providerFetch, oneClickHeaders } from "./http";
import { publicRpc, VERIFIER, payloadChallenge, versionedNonce, type SignedWebAuthn } from "../auth/intents";
import { hashPersonalMessage, recoverPersonalSignAddress, recoverPersonalSignPublicKey } from "../auth/recovery-wallet";
import { authenticateConfidential, readConfidentialBalances } from "./confidential";

export interface SignedEvmIntent { standard: "erc191"; payload: string; signature: string }
export type SignedRecoveryIntent = SignedWebAuthn | SignedEvmIntent;
export function recoveryIntentHash(signed: SignedRecoveryIntent) {
  return base58.encode(signed.standard === "erc191" ? hashPersonalMessage(signed.payload) : payloadChallenge(signed.payload));
}
const RELAY = "https://solver-relay-v2.chaindefuser.com/rpc";
const key = z.string().regex(/^(p256|secp256k1):[1-9A-HJ-NP-Za-km-z]{32,128}$/);
const account = z.string().regex(/^0x[0-9a-f]{40}$/);
const change = z.object({ intent: z.enum(["add_public_key", "remove_public_key"]), public_key: key }).strict();
export const keyPayload = z.object({ signer_id: account, verifying_contract: z.literal(VERIFIER), deadline: z.iso.datetime(), nonce: z.string(), intents: z.array(change).min(1).max(3) }).strict();
export function validateKeyPayload(payload: string, expectedAccount: string, expectedChanges: z.infer<typeof change>[], now = Date.now()) {
  const parsed = keyPayload.parse(JSON.parse(payload));
  const bytes = Buffer.from(parsed.nonce, "base64");
  if (parsed.signer_id !== expectedAccount || JSON.stringify(parsed.intents) !== JSON.stringify(expectedChanges) || Date.parse(parsed.deadline) <= now || bytes.length !== 32 || bytes.subarray(0, 5).toString("hex") !== "5628f6c600" || bytes.readBigInt64LE(9) !== BigInt(Date.parse(parsed.deadline)) * BigInt(1000000)) throw new Error("Key authorization differs from the recovery request or expired.");
  return parsed;
}
export function encodeEvmIntent(payload: string, signature: string, expectedAddress: string, expectedPublicKey?: string): SignedEvmIntent {
  if (recoverPersonalSignAddress(payload, signature) !== expectedAddress || (expectedPublicKey && recoverPersonalSignPublicKey(payload, signature) !== expectedPublicKey)) throw new AppError(ErrorCode.SignWithTheEnrolledRecoveryWallet);
  const bytes = Buffer.from(signature.slice(2), "hex");
  bytes[64] = bytes[64] >= 27 ? bytes[64] - 27 : bytes[64];
  return { standard: "erc191", payload, signature: `secp256k1:${base58.encode(bytes)}` };
}
async function view(method: string, args: Record<string, unknown>, fetcher = fetch) {
  const res = await publicRpc(JSON.stringify({ jsonrpc: "2.0", id: "recovery-view", method: "query", params: { request_type: "call_function", finality: "final", account_id: VERIFIER, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }), fetcher);
  const result = z.object({ result: z.object({ result: z.array(z.number().int().min(0).max(255)), block_height: z.number().int().positive() }) }).parse(await res.json());
  if (!res.ok) throw new AppError(ErrorCode.RecoveryKeyVerificationUnavailable);
  return { value: JSON.parse(Buffer.from(result.result.result).toString()), blockHeight: result.result.block_height };
}
async function relay(method: string, params: Record<string, unknown>, fetcher = fetch) {
  const credential = process.env.ONE_CLICK_JWT;
  if (!credential) throw new Error("Recovery relay is not configured.");
  const res = await providerFetch(fetcher, RELAY, { method: "POST", headers: oneClickHeaders(credential, "api-key"), body: JSON.stringify({ jsonrpc: "2.0", id: "recovery", method, params: [params] }) });
  const data = z.object({ result: z.unknown().optional(), error: z.unknown().optional() }).parse(await res.json());
  if (!res.ok || data.error || data.result === undefined) throw new AppError(ErrorCode.RecoveryRelayResponseUnavailable);
  return data.result;
}
export const recoveryProvider = {
  async salt(fetcher = fetch) { return z.string().regex(/^[0-9a-f]{8}$/).parse((await view("current_salt", {}, fetcher)).value); },
  async hasKey(accountId: string, publicKey: string, fetcher = fetch) { account.parse(accountId); key.parse(publicKey); return z.boolean().parse((await view("has_public_key", { account_id: accountId, public_key: publicKey }, fetcher)).value); },
  async prepare(accountId: string, changes: z.infer<typeof change>[], fetcher = fetch) {
    account.parse(accountId); changes.forEach(item => change.parse(item));
    const expires = Date.now() + 300000;
    return JSON.stringify({ signer_id: accountId, verifying_contract: VERIFIER, deadline: new Date(expires).toISOString(), nonce: versionedNonce(await this.salt(fetcher), expires), intents: changes });
  },
  async publish(signed: SignedRecoveryIntent, fetcher = fetch) {
    const expected = recoveryIntentHash(signed);
    const result = z.object({ status: z.enum(["OK", "FAILED"]), intent_hash: z.string().optional() }).parse(await relay("publish_intent", { quote_hashes: [], signed_data: signed }, fetcher));
    if (result.status === "FAILED") return "rejected" as const;
    if (result.intent_hash !== expected) throw new AppError(ErrorCode.RecoveryRelayReturnedAnUnexpectedIntentHash);
    return "submitted" as const;
  },
  async settled(intentHash: string, fetcher = fetch) {
    const result = z.object({ intent_hash: z.string(), status: z.enum(["PENDING", "TX_BROADCASTED", "SETTLED", "NOT_FOUND_OR_NOT_VALID"]), data: z.object({ hash: z.string().min(1) }).nullish() }).parse(await relay("get_status", { intent_hash: intentHash }, fetcher));
    if (result.intent_hash !== intentHash) throw new Error("Recovery status identity mismatch.");
    return result.status === "SETTLED" && !!result.data?.hash;
  },
  async authenticate(signed: SignedRecoveryIntent) {
    const auth = await authenticateConfidential(signed);
    await readConfidentialBalances(auth.accessToken);
    return auth;
  },
};
