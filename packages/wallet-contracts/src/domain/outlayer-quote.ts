import { z } from "zod";
const raw = z.string().regex(/^[0-9]+$/);
export const setupQuotePreviewSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable"), asset: z.enum(["USDC", "NEAR"]), reason: z.string() }),
  z.object({ status: z.literal("estimated"), asset: z.enum(["USDC", "NEAR"]), quotedAt: z.number(), expiresAt: z.number(), planHash: z.string(),
    costs: z.object({ accountCreation: raw, policyStorage: raw, networkFees: raw }), controllerReserveYoctoNear: raw,
    requiredYoctoNear: raw, maximumPaymentRaw: raw, paymentDecimals: z.number(), deliveryAppFeeBps: z.number(),
    sourceAssetId: z.string(), payer: z.string(), deliveryKind: z.literal("native-near"), priceReserved: z.literal(false),
    actualPolicyPrepared: z.boolean(), submissionEnabled: z.literal(false),
  }),
]);
export type SetupQuotePreview = z.infer<typeof setupQuotePreviewSchema>;
