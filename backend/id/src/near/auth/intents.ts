import { providerFetch } from "../providers/http";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { createHash, randomBytes } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { p256 } from "@noble/curves/nist.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58 } from "@scure/base";

export const VERIFIER = "intents.near";
const RPC = "https://rpc.mainnet.near.org";
const FASTNEAR_RPC = "https://rpc.mainnet.fastnear.com";

/**
 * A NEAR RPC call that carries no signed payload. FastNEAR answers in ~0.2 s; rpc.mainnet.near.org
 * is deprecated and rate-limited (30 requests a minute, ~3 s per call when measured on 2026-10-16),
 * so it is only the fallback. FASTNEAR_API_KEY, when set, goes in a header (never the URL, never to
 * the fallback); providerFetch rejects redirects, so it can't follow one to another host either.
 */
export async function publicRpc(body: string, fetcher: typeof fetch = fetch): Promise<Response> {
  const key = process.env.FASTNEAR_API_KEY?.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const response = await providerFetch(fetcher, FASTNEAR_RPC, { method: "POST", headers: key ? { ...headers, Authorization: `Bearer ${key}` } : headers, body, signal: AbortSignal.timeout(5_000) });
    if (response.ok) return response;
    await response.body?.cancel();
    console.warn("near.rpc.fallback", { status: response.status });
  } catch {
    console.warn("near.rpc.fallback", { status: "transport" });
  }
  return providerFetch(fetcher, RPC, { method: "POST", headers, body, signal: AbortSignal.timeout(12_000) });
}
export interface IntentsIdentity {
  accountId: string;
  publicKey: string;
}
export interface SignedWebAuthn {
  standard: "webauthn";
  payload: string;
  public_key: string;
  signature: string;
  client_data_json: string;
  authenticator_data: string;
}
export interface SigningCheck {
  status: "verified" | "unavailable";
  checkedAt: number;
  accountId: string;
  blockHeight?: number;
  message: string;
}
export function payloadChallenge(payload: string) {
  return createHash("sha256").update(payload, "utf8").digest();
}
export function identityFromRawKey(raw: Uint8Array): IntentsIdentity {
  if (raw.length !== 64) throw new AppError(ErrorCode.Expected64ByteP256PublicKey);
  p256.Point.fromBytes(Buffer.concat([Buffer.from([4]), raw])).assertValidity();
  const hash = keccak_256(Buffer.concat([Buffer.from("p256"), raw]));
  return {
    accountId: `0x${Buffer.from(hash.slice(12)).toString("hex")}`,
    publicKey: `p256:${base58.encode(raw)}`,
  };
}
export function intentsIdentity(coseBase64: string): IntentsIdentity {
  const key = isoCBOR.decodeFirst<Map<number, unknown>>(
    new Uint8Array(Buffer.from(coseBase64, "base64url")),
  );
  if (!(key instanceof Map)) throw new AppError(ErrorCode.InvalidCOSEPublicKey);
  if (key.get(1) !== 2 || key.get(3) !== -7 || key.get(-1) !== 1)
    throw new AppError(ErrorCode.IntentsAdapterRequiresAnES256P256Passkey);
  const x = key.get(-2),
    y = key.get(-3);
  if (
    !(x instanceof Uint8Array) ||
    !(y instanceof Uint8Array) ||
    x.length !== 32 ||
    y.length !== 32
  )
    throw new AppError(ErrorCode.InvalidP256Coordinates);
  return identityFromRawKey(Buffer.concat([x, y]));
}
/** Keep the wallet account fixed when an authorized signing key is replaced. */
export function accountIdentity(account: { publicKey?: string; intentsAccountId?: string; localRecovery?: { originalIdentity: IntentsIdentity } }): IntentsIdentity {
  if (!account.publicKey) throw new Error("Passkey public key missing.");
  const key = intentsIdentity(account.publicKey);
  const accountId = account.localRecovery?.originalIdentity.accountId ?? account.intentsAccountId ?? key.accountId;
  if (!/^0x[0-9a-f]{40}$/.test(accountId)) throw new Error("Invalid wallet account identity.");
  return { accountId, publicKey: key.publicKey };
}
export function versionedNonce(salt: string, deadline: number) {
  if (
    !/^[0-9a-f]{8}$/i.test(salt) ||
    !Number.isSafeInteger(deadline) ||
    deadline <= 0
  )
    throw new AppError(ErrorCode.InvalidNonceInputs);
  const nonce = Buffer.alloc(32);
  nonce.set(Buffer.from("5628f6c6", "hex"), 0);
  nonce[4] = 0; // Borsh enum index for VersionedNonce::V1.
  nonce.set(Buffer.from(salt, "hex"), 5);
  nonce.writeBigInt64LE(BigInt(deadline) * BigInt(1000000), 9);
  nonce.set(randomBytes(15), 17);
  return nonce.toString("base64");
}
export function createSigningProbe(
  identity: IntentsIdentity,
  salt: string,
  now = Date.now(),
) {
  const expires = now + 300000;
  const payload = JSON.stringify({
    signer_id: identity.accountId,
    verifying_contract: VERIFIER,
    deadline: new Date(expires).toISOString(),
    nonce: versionedNonce(salt, expires),
    intents: [],
  });
  return { payload, expires, challenge: payloadChallenge(payload) };
}
/** Authentication uses the SDK's timestamped 15-byte nonce portion:
 * issuance time (8-byte LE nanoseconds), then 7 random bytes.
 * This message contains no executable financial intents.
 */
export function createConfidentialOwnershipProbe(
  identity: IntentsIdentity,
  salt: string,
  now = Date.now(),
) {
  const probe = createSigningProbe(identity, salt, now);
  const payload = JSON.parse(probe.payload);
  const nonce = Buffer.from(payload.nonce, "base64");
  nonce.writeBigInt64LE(BigInt(now) * BigInt(1000000), 17);
  payload.nonce = nonce.toString("base64");
  const message = JSON.stringify(payload);
  return { payload: message, expires: probe.expires, challenge: payloadChallenge(message) };
}
export function encodeAssertion(
  identity: IntentsIdentity,
  payload: string,
  assertion: AuthenticationResponseJSON,
): SignedWebAuthn {
  const der = p256.Signature.fromBytes(
    Buffer.from(assertion.response.signature, "base64url"),
    "der",
  );
  const canonical = new p256.Signature(
    der.r,
    der.hasHighS() ? p256.Point.Fn.ORDER - der.s : der.s,
  );
  const clientData = Buffer.from(
    assertion.response.clientDataJSON,
    "base64url",
  ).toString("utf8");
  const client = JSON.parse(clientData);
  if (
    client.type !== "webauthn.get" ||
    client.challenge !== payloadChallenge(payload).toString("base64url")
  )
    throw new AppError(ErrorCode.AssertionIsNotBoundToTheIntentsPayload);
  return {
    standard: "webauthn",
    payload,
    public_key: identity.publicKey,
    signature: `p256:${base58.encode(canonical.toBytes("compact"))}`,
    client_data_json: clientData,
    authenticator_data: Buffer.from(
      assertion.response.authenticatorData,
      "base64url",
    ).toString("base64url"),
  };
}
// Only the fixed, empty probe can reach this view-only RPC adapter. It exposes no
// transaction/relay submission method and never accepts transfer or key-change intents.
export function validateProbe(signed: SignedWebAuthn, expectedIdentity?: IntentsIdentity) {
  const p = JSON.parse(signed.payload);
  if (
    signed.standard !== "webauthn" ||
    p.verifying_contract !== VERIFIER ||
    !Array.isArray(p.intents) ||
    p.intents.length !== 0 ||
    !/^0x[0-9a-f]{40}$/.test(p.signer_id)
  )
    throw new AppError(ErrorCode.OnlyEmptySigningProbesCanBeSimulated);
  if (
    !signed.public_key.startsWith("p256:") ||
    (expectedIdentity ? signed.public_key !== expectedIdentity.publicKey || p.signer_id !== expectedIdentity.accountId : identityFromRawKey(base58.decode(signed.public_key.slice(5))).accountId !== p.signer_id)
  )
    throw new AppError(ErrorCode.ProbeIdentityMismatch);
  return p as {
    signer_id: string;
    nonce: string;
    deadline: string;
    intents: [];
  };
}
export interface Simulation {
  intents_executed: {
    account_id: string;
    nonce: string;
    intent_hash: string;
  }[];
  state: { current_salt: string };
  invariant_violated?: unknown;
}
export async function simulateSignedIntents(
  signed: SignedWebAuthn[],
  fetcher: typeof fetch = fetch,
) {
  if (signed.length > 1) throw new AppError(ErrorCode.OnlyOneSignedIntentIsAllowed);
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: "near-terminal-signing-check",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: VERIFIER,
      method_name: "simulate_intents",
      args_base64: Buffer.from(JSON.stringify({ signed })).toString("base64"),
    },
  });
  // Only the empty shared-salt read may leave near.org: an RPC operator that saw a signed
  // payload could submit it.
  const res = signed.length
    ? await providerFetch(fetcher, RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(12000) })
    : await publicRpc(body, fetcher);
  if (!res.ok) throw new AppError(ErrorCode.NearSimulationUnavailable, res.status);
  const rpc = await res.json();
  if (rpc.error || rpc.result?.error)
    throw new AppError(ErrorCode.NEARVerifierRejectedTheSimulationOrRPCRequest);
  if (
    !Array.isArray(rpc.result?.result) ||
    !Number.isSafeInteger(rpc.result.block_height)
  )
    throw new AppError(ErrorCode.InvalidNEARRPCResponse);
  const output = JSON.parse(
    Buffer.from(rpc.result.result).toString("utf8"),
  ) as Simulation;
  if (
    !/^[0-9a-f]{8}$/i.test(output.state?.current_salt ?? "") ||
    !Array.isArray(output.intents_executed) ||
    output.invariant_violated
  )
    throw new AppError(ErrorCode.InvalidSimulationResult);
  return { output, blockHeight: rpc.result.block_height as number };
}

export async function simulateProbe(
  signed: SignedWebAuthn[] = [],
  fetcher: typeof fetch = fetch,
  expectedIdentity?: IntentsIdentity,
) {
  if (signed.length > 1) throw new AppError(ErrorCode.OnlyOneSigningProbeIsAllowed);
  signed.forEach(item => validateProbe(item, expectedIdentity));
  const simulation = await simulateSignedIntents(signed, fetcher);
  if (signed.length) {
    const probe = validateProbe(signed[0], expectedIdentity);
    const expectedHash = base58.encode(payloadChallenge(signed[0].payload));
    if (
      simulation.output.intents_executed.length !== 1 ||
      !simulation.output.intents_executed.some(
        (e) => e.account_id === probe.signer_id && e.nonce === probe.nonce && e.intent_hash === expectedHash,
      )
    ) throw new AppError(ErrorCode.VerifierDidNotConfirmTheExpectedSigningProbe);
  }
  return simulation;
}
