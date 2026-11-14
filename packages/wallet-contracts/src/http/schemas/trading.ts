import { feePlanSchema, feeReceiptSchema, tradingFeeDisclosureSchema } from "../../domain/trading-fees";
import { selectedPairSchema } from "../../domain/catalog";
import { z } from "zod";
import { amount, rawAmount, text, timestamp, side, operationState } from "./common";

export const DEFAULT_SLIPPAGE_BPS = 30;
// Old browser preferences and clients using Auto now receive the fixed default.
export const slippageSettings = z.preprocess(value =>
  value && typeof value === "object" && "mode" in value && value.mode === "auto" ? { mode: "default" } : value,
  z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("default") }),
    z.object({ mode: z.literal("custom"), bps: z.number().int().min(1).max(500) }),
  ]),
);
export type SlippageSettings = z.infer<typeof slippageSettings>;

export const limitPreview = z.object({
  feePlan: feePlanSchema.optional(),
  feeReceipt: feeReceiptSchema.optional(),
  tradingFee: tradingFeeDisclosureSchema.optional(),
  pair: selectedPairSchema.optional(),
  submissionEnabled: z.literal(false), quantity: amount, price: amount, side,
  inputSymbol: text, principal: amount, available: amount, shortfall: amount, balanceBlock: timestamp,
  fees: text, liquidityVerified: z.boolean(),
  request: z.object({ data: z.object({ type: text, attributes: z.object({
    orderType: text, baseAsset: text, quoteAsset: text, quantity: rawAmount, side: text, price: amount,
    depositType: text, refundType: text, recipientType: text, refundTo: text, recipient: text,
    confidentiality: text, timeInForce: text, deadline: z.iso.datetime({ offset: true }),
  }) }) }),
});
export const executableLimitReview = limitPreview.extend({ submissionEnabled: z.literal(true), orderId: text, fundingAmount: amount, fundingExpiresAt: z.iso.datetime({ offset: true }).optional() });
const marketFields = {
  feeReceipt: feeReceiptSchema.optional(),
  tradingFee: tradingFeeDisclosureSchema.optional(),
  pair: selectedPairSchema.optional(),
  confidentiality: z.literal("advanced").optional(),
  orderType: z.literal("market"), side, quantity: amount, inputSymbol: text, outputSymbol: text,
  principal: amount, estimatedOutput: amount, minimumOutput: amount, available: amount, shortfall: amount,
  slippagePolicy: z.union([z.object({ mode: z.literal("default") }),z.object({ mode: z.literal("auto"), source: z.enum(["history", "fallback"]) }), z.object({ mode: z.literal("custom") })]).optional(),
  balanceBlock: timestamp, slippageBps: z.number().int().nonnegative(), expiresAt: z.iso.datetime({ offset: true }),
};
export const marketPreview = z.object({ ...marketFields, quoteReference: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(), submissionEnabled: z.literal(false), timeEstimateSeconds: z.number().nonnegative().nullable() });
export const marketReview = z.object({ ...marketFields, inputSymbol: text, submissionEnabled: z.literal(true),
  inputRaw: rawAmount, outputRaw: rawAmount, depositAddress: text, depositMemo: z.null(), correlationId: text,
});
export type MarketReview = z.infer<typeof marketReview>;
export type ExecutableLimitReview = z.infer<typeof executableLimitReview>;
export const providerOrder = z.object({
  feeReceipt: feeReceiptSchema.optional(),
  id: text, fillStatus: z.enum(["AWAITING_DEPOSIT", "OPEN", "PARTIALLY_FILLED", "FILLED", "PENDING_CANCEL", "CANCELED", "EXPIRED", "UNTRIGGERED"]),
  payoutStatus: text, payoutFinal: z.boolean(), depositAddress: text, depositMemo: text.optional(),
  fundingAmount: rawAmount, inputAsset: text, depositedAmount: rawAmount,
  partialFills: z.array(z.object({ id: text, amountIn: rawAmount, amountOut: rawAmount, createdAt: timestamp.optional() })),
  payoutTxHashes: z.array(text).optional(), refundTxHash: text.optional(),
});
export const order = z.object({ id: text, ownerId: text, requestId: text, terms: text, preview: limitPreview,
  createdAt: timestamp, updatedAt: timestamp, state: z.enum(["creating", "created", "failed", "unknown"]),
  fundingState: z.enum(["submitting", "submitted", "unknown"]).optional(), fundingIntentHash: text.optional(),
  provider: providerOrder.optional(), cancelPending: z.boolean().optional(), syncError: text.optional(),
});
// Older persisted trades predate raw-amount storage. History does not authorize execution.
export const historicalMarketReview = marketReview.extend({ inputRaw: rawAmount.optional(), outputRaw: rawAmount.optional() });
export const tradeExecution = z.object({ inputRaw: rawAmount, outputRaw: rawAmount, inputAmount: amount, outputAmount: amount, settledAt: timestamp });
export const trade = z.object({ id: text, createdAt: timestamp, updatedAt: timestamp, state: operationState,
  intentHash: text.optional(), nearTxHashes: z.array(text).optional(), execution: tradeExecution.optional(), review: historicalMarketReview,
});
export type Trade = z.infer<typeof trade>;

export type LimitPreview = z.infer<typeof limitPreview>;
export type MarketPreview = z.infer<typeof marketPreview>;
export type StoredOrder = z.infer<typeof order>;
