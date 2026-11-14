import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyStoredPolicy } from "./activation-checks";
import { signSetupTransaction, transactionStatus } from "./near-transactions";
import { ownerProof, ownerRequest, ownerRequestHash, type OwnerRequest } from "./owner-request";
import { verifyPolicyWrite } from "./policy-write";

type PolicyWrite = ReturnType<typeof verifyPolicyWrite>;

export function preparePolicyExecution(controllerId: string, write: PolicyWrite, storageDeposit: string) {
  return ownerRequest(controllerId, undefined, write, storageDeposit);
}

/** The caller must persist the signed transaction before broadcasting it. */
export async function signPolicyExecution(
  payerSeed: string,
  gasPriceCap: string,
  message: OwnerRequest,
  assertion: AuthenticationResponseJSON,
  verifiedChallenge: string,
) {
  if (ownerRequestHash(message).toString("base64url") !== verifiedChallenge) {
    throw new Error("Controller policy execution challenge mismatch.");
  }
  if (Date.parse(message.created_at) + message.timeout_secs * 1000 <= Date.now() + 15_000) {
    throw new Error("Controller policy execution approval expired.");
  }
  const [promise] = message.request.external;
  const [action] = promise?.actions ?? [];
  if (message.request.internal.length || message.request.external.length !== 1 ||
      !promise || !action || promise.receiver_id !== "outlayer.near" || promise.actions.length !== 1 ||
      action.payload.function_name !== "store_wallet_policy") {
    throw new Error("Invalid controller policy execution request.");
  }
  const write = z.object({
    valid_until: z.number().int().positive().safe(),
  }).parse(JSON.parse(Buffer.from(action.payload.args, "base64").toString("utf8")));
  if (write.valid_until * 1000 <= Date.now() + 15_000) {
    throw new Error("OutLayer policy signature expired before filing.");
  }
  return signSetupTransaction(payerSeed, message.signer_id, {
    kind: "call",
    method: "w_execute_signed",
    argsBase64: Buffer.from(JSON.stringify({ msg: message, proof: ownerProof(assertion) })).toString("base64"),
    gas: "250000000000000",
    deposit: action.payload.deposit,
  }, gasPriceCap);
}

export async function confirmPolicyExecution(
  transaction: { hash: string; signerId: string },
  expected: Parameters<typeof verifyStoredPolicy>[0],
) {
  const status = await transactionStatus(transaction.hash, transaction.signerId);
  if (status !== "success") return status;
  await verifyStoredPolicy(expected);
  return "success";
}
