import { z } from "zod";
import { catalogAsset } from "../../domain/catalog";
import { amount } from "./common";
import { marketReview } from "./trading";
export const fundingLegState = z.enum(["ready", "submitting", "submitted", "unknown", "settled", "failed", "cancelled"]);
export const fundingBatch = z.object({
  id: z.string(), createdAt: z.number(), updatedAt: z.number(),
  state: z.enum(["ready", "processing", "unknown", "settled", "partial", "failed", "cancelled"]),
  expiresAt: z.string(), outputAmount: amount, minimumOutput: amount,
  inputUsd: z.string().nullable(), costUsd: z.string().nullable(),
  excluded: z.array(z.object({ asset: catalogAsset, amount, reason: z.string() })),
  legs: z.array(z.object({ id: z.string(), asset: catalogAsset, amount, state: fundingLegState,
    review: marketReview, intentHash: z.string().optional(), providerStatus: z.string().optional(),
  })),
});
export type FundingBatch = z.infer<typeof fundingBatch>;
