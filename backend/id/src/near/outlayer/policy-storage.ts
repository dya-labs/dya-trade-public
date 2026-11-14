import { z } from "zod";
import { publicRpc } from "../auth/intents";

// The live mainnet build exercised by toolkit/mainnet-preflight.mjs. Updating
// this pin requires a fresh ABI/storage/refund review, not just a new estimate.
export const OUTLAYER_POLICY_CONTRACT = "outlayer.near";
export const OUTLAYER_POLICY_CODE_HASH = "AsbxRWTQ2mQAazgz1bbAC72oZ1H8UKL33JKwZmG2pjn2";
const request = z.object({
  walletPublicKey: z.string().regex(/^[0-9a-f]{64}$/),
  storageRefundTo: z.string().min(2).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/).optional(),
  encryptedPolicy: z.string().min(4).max(1_000_000).refine(value => Buffer.from(value, "base64").toString("base64") === value, "Canonical base64 policy required"),
}).strict();

/** A single cost component, never a total setup/payment quote. No registration,
 * signatures, broadcasts or state writes. Use actual provider ciphertext. */
export async function estimatePolicyStorage(input: z.input<typeof request>, fetcher: typeof fetch = fetch) {
  const { walletPublicKey, encryptedPolicy, storageRefundTo } = request.parse(input);
  async function query(params: Record<string, unknown>) {
    const response = await publicRpc(JSON.stringify({ jsonrpc: "2.0", id: "outlayer-policy-storage", method: "query", params }), fetcher);
    if (!response.ok) throw new Error("Policy storage estimate is unavailable.");
    const body = z.object({ result: z.unknown().optional(), error: z.unknown().optional() }).parse(await response.json());
    if (body.error || !body.result) throw new Error("Policy storage estimate was not confirmed.");
    return body.result;
  }
  const deployment = z.object({ code_hash: z.string(), block_hash: z.string().min(1), block_height: z.number().int().nonnegative() }).parse(await query({ request_type: "view_account", account_id: OUTLAYER_POLICY_CONTRACT, finality: "final" }));
  if (deployment.code_hash !== OUTLAYER_POLICY_CODE_HASH) throw new Error("OutLayer contract changed. Setup costs need review.");
  const estimate = z.object({ result: z.array(z.number().int().min(0).max(255)), block_hash: z.string() }).parse(await query({
    request_type: "call_function", account_id: OUTLAYER_POLICY_CONTRACT, block_id: deployment.block_hash,
    method_name: "estimate_wallet_policy_cost", args_base64: Buffer.from(JSON.stringify({ wallet_pubkey: `ed25519:${walletPublicKey}`, encrypted_data: encryptedPolicy, ...(storageRefundTo ? { storage_refund_to: storageRefundTo } : {}) })).toString("base64"),
  }));
  if (estimate.block_hash !== deployment.block_hash) throw new Error("Policy estimate block changed.");
  const yoctoNear = z.string().regex(/^[0-9]+$/).parse(JSON.parse(Buffer.from(estimate.result).toString("utf8")));
  return { kind: "policy-storage" as const, network: "mainnet" as const, contractId: OUTLAYER_POLICY_CONTRACT, codeHash: deployment.code_hash, blockHash: deployment.block_hash, blockHeight: deployment.block_height, yoctoNear };
}
