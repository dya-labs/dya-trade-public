import { catalogAsset } from "../../domain/catalog";
import { z } from "zod";
import { amount, rawAmount, text, timestamp, operationState, depositStatus } from "./common";

export const depositQuote = z.object({
  confidentiality: z.literal("advanced").optional(),
  minAmountInFormatted: amount.optional(),
  showDollarBuffer: z.boolean().optional(),
  direction: z.literal("deposit"), sourceChain: text, asset: text, amount,
  sourceAssetId: text.optional(), targetAssetId: text.optional(), sourceNetwork: text.optional(),
  refundTo: text, refundType: z.enum(["ORIGIN_CHAIN", "CONFIDENTIAL_INTENTS"]).optional(), recipient: text, depositAddress: text, depositMemo: text.nullable(),
  amountIn: rawAmount, amountInFormatted: amount, amountOut: rawAmount, amountOutFormatted: amount,
  minAmountOut: rawAmount, deadline: z.iso.datetime({ offset: true }), timeEstimateSeconds: z.number().nullable(),
  correlationId: text, signature: text, submissionEnabled: z.literal(true),
});
export const trackedDepositQuote = depositQuote.extend({ id: text });
export type TrackedDepositQuote = z.infer<typeof trackedDepositQuote>;
export const deposit = z.object({ id: text, createdAt: timestamp, status: depositStatus, quote: depositQuote, creditedAmount: amount.optional(),
  originChainTxHashes: z.array(text).optional(), destinationChainTxHashes: z.array(text).optional(),
});
export const withdrawalReview = z.object({
  confidentiality: z.literal("advanced").optional(),
  direction: z.literal("withdraw"), sourceChain: z.literal("NEAR Intents"), destinationChain: text,
  route: z.object({ origin: catalogAsset, destination: catalogAsset }).optional(),
  asset: text, amount, amountRaw: rawAmount, destinationWallet: text, destinationAsset: text, originAsset: text,
  expectedReceive: amount, minimumReceive: amount, available: amount, balanceBlock: timestamp, deadline: z.iso.datetime({ offset: true }),
  depositAddress: text, depositMemo: z.null(), correlationId: text,
});
// Historical withdrawals predate originAsset storage; new preparation remains strict.
export const historicalWithdrawalReview = withdrawalReview.extend({ originAsset: text.optional() });
export const withdrawal = z.object({ id: text, createdAt: timestamp, state: operationState, intentHash: text.optional(),
  originChainTxHashes: z.array(text).optional(), destinationChainTxHashes: z.array(text).optional(), review: historicalWithdrawalReview,
});
export type WithdrawalReview = z.infer<typeof withdrawalReview>;
export type DepositItem = z.infer<typeof deposit>;
export type WithdrawalItem = z.infer<typeof withdrawal>;
