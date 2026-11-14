import { createHash } from "node:crypto";
import { z } from "zod";
import { providerFetch } from "../providers/http";
import { nearRpc } from "./near-transactions";
import { controllerApprovalProof, type ControllerApproval } from "./owner-request";

const origin = "https://api.outlayer.ai/wallet/v1";
const approvalIdSchema = z.uuid();
const digest = z.string().regex(/^[0-9a-f]{64}$/);

export async function prepareControllerVote(
  expected: { approvalId: string; walletPublicKey: string; controllerId: string; canonicalOperation: string | ((operation: string) => string) },
  fetcher: typeof fetch = fetch,
): Promise<ControllerApproval> {
  const approvalId = approvalIdSchema.parse(expected.approvalId);
  const response = await providerFetch(fetcher, `${origin}/approval/${approvalId}`);
  if (!response.ok) throw new Error("OutLayer approval unavailable.");

  const detail = z.object({
    id: z.literal(approvalId),
    wallet_pubkey: z.literal(`ed25519:${expected.walletPublicKey}`),
    request_hash: digest,
    op_canonical: z.string(),
    expires_at: z.iso.datetime({ offset: true }),
  }).parse(await response.json());
  if (Date.parse(detail.expires_at) <= Date.now()) throw new Error("OutLayer approval expired.");
  const canonical = typeof expected.canonicalOperation === "string"
    ? expected.canonicalOperation : expected.canonicalOperation(detail.op_canonical);
  if (detail.op_canonical !== canonical) throw new Error("OutLayer approval operation mismatch.");
  const hash = createHash("sha256").update(detail.op_canonical).digest("hex");
  if (hash !== detail.request_hash) throw new Error("OutLayer approval hash mismatch.");

  const block = z.object({ header: z.object({ timestamp_nanosec: z.string().regex(/^\d+$/) }) })
    .parse(await nearRpc("block", { finality: "final" }, fetcher));
  const timestamp = Number(BigInt(block.header.timestamp_nanosec) / BigInt(1_000_000)) - 1000;
  return {
    chain_id: "mainnet",
    signer_id: expected.controllerId,
    path: [],
    timestamp: new Date(timestamp).toISOString(),
    payload: `approve:${approvalId}:${detail.wallet_pubkey}:${hash}`,
  };
}

export async function preparePolicyUpdateVote(
  expected: {
    approvalId: string;
    walletPublicKey: string;
    controllerId: string;
    policyHash: string;
    currentVersion: number;
    proposedVersion?: number;
    locked?: boolean;
  },
  fetcher: typeof fetch = fetch,
) {
  const { policyHash, currentVersion, proposedVersion, locked = true, ...identity } = expected;
  let version = 0;
  const message = await prepareControllerVote({
    ...identity,
    canonicalOperation: operation => {
      version = z.object({ version: z.number().int().positive().safe().gt(currentVersion) }).parse(JSON.parse(operation)).version;
      if (proposedVersion !== undefined && version !== proposedVersion) throw new Error("Policy version mismatch.");
      return JSON.stringify({
      caller: identity.controllerId,
      kind: "policy_update",
      locked,
      policy_hash: digest.parse(policyHash),
      version,
      wallet_pubkey: `ed25519:${identity.walletPublicKey}`,
      });
    },
  }, fetcher);
  return { message, version };
}

export async function submitControllerVote(
  approvalId: string,
  message: ControllerApproval,
  assertion: Parameters<typeof controllerApprovalProof>[1],
  fetcher: typeof fetch = fetch,
) {
  const id = approvalIdSchema.parse(approvalId);
  if (!message.payload.startsWith(`approve:${id}:`)) throw new Error("Approval ID mismatch.");
  const authorization = controllerApprovalProof(message, assertion);
  const resolution = z.object({ result: z.array(z.number().int().min(0).max(255)) }).parse(
    await nearRpc("query", {
      request_type: "call_function",
      finality: "final",
      account_id: message.signer_id,
      method_name: "w_resolve_auth",
      args_base64: Buffer.from(JSON.stringify({ path: message.path, authorization })).toString("base64"),
    }, fetcher),
  );
  z.object({ payload: z.literal(message.payload) }).parse(JSON.parse(Buffer.from(resolution.result).toString()));

  const response = await providerFetch(fetcher, `${origin}/approve/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_id: message.signer_id, authorization }),
  });
  if (!response.ok) throw new Error("OutLayer vote could not be confirmed. Check approval status before retrying.");
  return z.object({
    approval_id: z.literal(id),
    status: z.enum(["pending", "approved"]),
    request_id: z.uuid().nullish(),
  }).parse(await response.json());
}
