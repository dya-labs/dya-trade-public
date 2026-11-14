import { z } from "zod";

const proposal = {
  unlockedAssetWrite: z.record(z.string(), z.unknown()).optional(),
  previousAllowedAssets: z.array(z.string()).optional(),
  unlockedTradingTest: z.literal(true).optional(),
  tradeApprovalExclusions: z.boolean().optional(),
  previousTradeApprovalExclusions: z.boolean().optional(),
  tradingEnabled: z.boolean().optional(),
  previousTradingEnabled: z.boolean().optional(),
  allowedAssets: z.array(z.string()).optional(),
  addNearUsdc: z.literal(true).optional(),
  previousEnabled: z.boolean().optional(),
  policyKind: z.enum(["transfer-v2", "transfer-v3", "send-disabled"]).optional(),
  approvalId: z.uuid(),
  requestId: z.uuid(),
  version: z.number().int().positive().safe(),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/),
  encryptedPolicy: z.string().min(4).max(4096),
};
const signedTransaction = z.object({
  hash: z.string().min(1),
  signerId: z.string().min(1),
  receiverId: z.string().min(1),
  bytes: z.string().min(1),
}).strict();

export const sendPolicyState = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("proposed"), ...proposal }).strict(),
  z.object({ phase: z.literal("voted"), ...proposal }).strict(),
  z.object({ phase: z.literal("submitted"), ...proposal, transaction: signedTransaction }).strict(),
  z.object({ phase: z.literal("confirmed"), ...proposal, transactionHash: z.string().min(1) }).strict(),
  z.object({ phase: z.literal("failed"), ...proposal }).strict(),
]);

export type SendPolicyState = z.infer<typeof sendPolicyState>;
export type SendPolicyEvent =
  | { type: "vote-confirmed" }
  | { type: "transaction-signed"; transaction: z.infer<typeof signedTransaction> }
  | { type: "policy-confirmed"; transactionHash: string }
  | { type: "transaction-failed" }
  | { type: "proposal-ended" };

export function nextSendPolicy(state: SendPolicyState, event: SendPolicyEvent): SendPolicyState | undefined {
  if (state.phase === "proposed" && event.type === "vote-confirmed") return { ...state, phase: "voted" };
  if (state.phase === "voted" && event.type === "transaction-signed") {
    return { ...state, phase: "submitted", transaction: event.transaction };
  }
  if ((state.phase === "proposed" || state.phase === "voted") && event.type === "proposal-ended") return { ...state, phase: "failed" };
  if (state.phase !== "submitted") return;
  const { transaction, ...policy } = state;
  if (event.type === "transaction-failed") return { ...policy, phase: "failed" };
  if (event.type === "policy-confirmed" && transaction.hash === event.transactionHash) {
    return { ...policy, phase: "confirmed", transactionHash: transaction.hash };
  }
}
