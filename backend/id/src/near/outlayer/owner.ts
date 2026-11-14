import { createHash } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { p256 } from "@noble/curves/nist.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58 } from "@scure/base";
import { z } from "zod";
import { publicRpc } from "../auth/intents";

export const PASSKEY_PUBLISHER = "0saf343be226341c0eca7dba6d0b29d49bdff3ad03";
// NOTE: Pilot only. Before going live, publish the reviewed code by immutable hash
// and migrate controller/policy bindings; this byte check cannot prevent publisher updates.
export const PASSKEY_CODE_HASH = "qD9cxbe38rJn7BwUBtqaC2vVAiYD7TS4vnrafccHsRp";
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const str = (s: string) => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);

/** Exact published passkey-wallet initial state. No user names or custody credentials. */
export function ownerPlan(coseBase64: string) {
  const { controllerId, codeHash } = deriveOwnerPlan(coseBase64, "publisher");
  return { controllerId, codeHash };
}
export function ownerInitialization(coseBase64: string) {
  return deriveOwnerPlan(coseBase64, "publisher");
}

/** Candidate for a later migration; not the selected pilot identity. */
export function immutableOwnerPlan(coseBase64: string) {
  return deriveOwnerPlan(coseBase64, "immutable");
}

function deriveOwnerPlan(coseBase64: string, reference: "immutable" | "publisher") {
  const key = isoCBOR.decodeFirst<Map<number, unknown>>(new Uint8Array(Buffer.from(coseBase64, "base64url")));
  if (!(key instanceof Map) || key.get(1) !== 2 || key.get(3) !== -7 || key.get(-1) !== 1) throw new Error("An ES256 passkey is required.");
  const x = key.get(-2), y = key.get(-3);
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) throw new Error("Invalid passkey public key.");
  const point = p256.Point.fromBytes(Buffer.concat([Buffer.from([4]), x, y]));
  point.assertValidity();
  const compressed = point.toBytes(true);
  const state = Buffer.concat([Buffer.from([1]), u32(0), compressed, u32(3600), Buffer.alloc(8), u32(0), u32(0), u32(0)]);
  const codeReference = reference === "immutable"
    ? Buffer.concat([Buffer.from([0, 0]), base58.decode(PASSKEY_CODE_HASH)])
    : Buffer.concat([Buffer.from([0, 1]), str(PASSKEY_PUBLISHER)]);
  const stateInit = Buffer.concat([codeReference, u32(1), u32(0), u32(state.length), state]);
  return { controllerId: `0s${Buffer.from(keccak_256(stateInit)).subarray(12).toString("hex")}`, codeHash: PASSKEY_CODE_HASH, stateInitBase64: stateInit.toString("base64"), walletPublicKey: `p256:${base58.encode(compressed)}` };
}

export async function checkPublishedOwnerCode(fetcher: typeof fetch = fetch) {
  const response = await publicRpc(JSON.stringify({ jsonrpc: "2.0", id: "outlayer-owner", method: "query", params: { request_type: "view_global_contract_code_by_account_id", finality: "final", account_id: PASSKEY_PUBLISHER } }), fetcher);
  if (!response.ok) throw new Error("Mainnet contract check is unavailable.");
  const result = z.object({ result: z.object({ code_base64: z.string().min(1) }) }).parse(await response.json());
  const actual = base58.encode(createHash("sha256").update(Buffer.from(result.result.code_base64, "base64")).digest());
  if (actual !== PASSKEY_CODE_HASH) throw new Error("Mainnet passkey contract changed. Setup needs review.");
}

/** Immutable publication is a separate namespace from the publisher reference. */
export async function readImmutableOwnerCode(fetcher: typeof fetch = fetch) {
  const response = await publicRpc(JSON.stringify({ jsonrpc: "2.0", id: "outlayer-owner-immutable", method: "query", params: { request_type: "view_global_contract_code", finality: "final", code_hash: PASSKEY_CODE_HASH } }), fetcher);
  if (!response.ok) throw new Error("Immutable owner contract check is unavailable.");
  const body = z.object({ result: z.object({ code_base64: z.string().min(1), block_hash: z.string(), block_height: z.number().int().nonnegative() }).optional(), error: z.object({ cause: z.object({ name: z.string(), info: z.object({ block_hash: z.string(), block_height: z.number().int().nonnegative() }).passthrough().optional() }).passthrough().optional() }).passthrough().optional() }).parse(await response.json());
  if (body.error?.cause?.name === "NO_GLOBAL_CONTRACT_CODE" && body.error.cause.info) return { status: "publication-required" as const, codeHash: PASSKEY_CODE_HASH, blockHash: body.error.cause.info.block_hash, blockHeight: body.error.cause.info.block_height };
  if (body.error || !body.result) throw new Error("Immutable owner contract availability was not confirmed.");
  const actual = base58.encode(createHash("sha256").update(Buffer.from(body.result.code_base64, "base64")).digest());
  if (actual !== PASSKEY_CODE_HASH) throw new Error("Immutable passkey contract does not match the reviewed build.");
  return { status: "available" as const, codeHash: PASSKEY_CODE_HASH, blockHash: body.result.block_hash, blockHeight: body.result.block_height };
}
