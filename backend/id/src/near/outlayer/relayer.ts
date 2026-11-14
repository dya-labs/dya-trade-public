import { createPrivateKey, createPublicKey } from "node:crypto";
import { base58 } from "@scure/base";
import { z } from "zod";
import { publicRpc } from "../auth/intents";

export type RelayerReadiness =
  | { status: "unconfigured"; submissionEnabled: false }
  | { status: "verified"; accountId: string; publicKey: string; nativeBalanceYoctoNear: string; blockHash: string; blockHeight: number; submissionEnabled: false };

/** Validate the dedicated implicit-account secret without retaining or returning it.
 * No signer is exported: read-only setup must not gain submission authority. */
export function relayerPublicConfiguration(env: { OUTLAYER_RELAYER_ACCOUNT_ID?: string; OUTLAYER_RELAYER_PRIVATE_KEY?: string } = { OUTLAYER_RELAYER_ACCOUNT_ID: process.env.OUTLAYER_RELAYER_ACCOUNT_ID, OUTLAYER_RELAYER_PRIVATE_KEY: process.env.OUTLAYER_RELAYER_PRIVATE_KEY }) {
  const accountId = env.OUTLAYER_RELAYER_ACCOUNT_ID?.trim();
  const secret = env.OUTLAYER_RELAYER_PRIVATE_KEY?.trim();
  if (!accountId && !secret) return null;
  try {
    if (!accountId || !/^[0-9a-f]{64}$/.test(accountId) || !secret?.startsWith("ed25519:")) throw new Error();
    const bytes = base58.decode(secret.slice(8));
    if (bytes.length !== 64) throw new Error();
    const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(bytes.subarray(0, 32))]), format: "der", type: "pkcs8" });
    const publicBytes = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32);
    if (!publicBytes.equals(Buffer.from(bytes.subarray(32))) || publicBytes.toString("hex") !== accountId) throw new Error();
    return { accountId, publicKey: `ed25519:${base58.encode(publicBytes)}` };
  } catch { throw new Error("Local setup relayer configuration is invalid. Check its account ID and key."); }
}

/** Public RPC reads only: verify key authority and native balance at one
 * finalized block. Native NEAR delivery needs no wNEAR receiver registration. */
export async function readRelayerReadiness(fetcher: typeof fetch = fetch, env?: Parameters<typeof relayerPublicConfiguration>[0]): Promise<RelayerReadiness> {
  const configuration = relayerPublicConfiguration(env);
  if (!configuration) return { status: "unconfigured", submissionEnabled: false };
  async function query(params: Record<string, unknown>) {
    const response = await publicRpc(JSON.stringify({ jsonrpc: "2.0", id: "outlayer-relayer-readiness", method: "query", params }), fetcher);
    if (!response.ok) throw new Error("Setup relayer mainnet check is unavailable.");
    const body = z.object({ result: z.unknown().optional(), error: z.unknown().optional() }).parse(await response.json());
    if (body.error || !body.result) throw new Error("Setup relayer mainnet check was not confirmed.");
    return body.result;
  }
  const account = z.object({ amount: z.string().regex(/^[0-9]+$/), block_hash: z.string().min(1), block_height: z.number().int().nonnegative() }).parse(await query({ request_type: "view_account", finality: "final", account_id: configuration.accountId }));
  const access = await query({ request_type: "view_access_key", block_id: account.block_hash, account_id: configuration.accountId, public_key: configuration.publicKey });
  z.object({ permission: z.literal("FullAccess"), block_hash: z.literal(account.block_hash) }).parse(access);
  return { status: "verified", ...configuration, nativeBalanceYoctoNear: account.amount, blockHash: account.block_hash, blockHeight: account.block_height, submissionEnabled: false };
}
