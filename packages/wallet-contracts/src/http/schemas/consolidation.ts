import { z } from "zod";
import { catalogAsset } from "../../domain/catalog";
import { rawAmount, amount } from "./common";
export const consolidationReview = z.object({
  id: z.string(), expiresAt: z.string(), accountId: z.string(),
  inputs: z.array(z.object({ asset: catalogAsset, raw: rawAmount, amount, outputRaw: rawAmount })),
  excluded: z.array(z.object({ asset: catalogAsset, amount, reason: z.string() })).optional(),
  outputRaw: rawAmount, outputAmount: amount, inputAmount: amount, costAmount: z.string(),
});
export const consolidationOperation = z.object({
  id: z.string(), createdAt: z.number(), state: z.enum(["submitting", "submitted", "unknown", "settled", "failed"]),
  intentHash: z.string(), txHash: z.string().optional(), review: consolidationReview,
});
export type ConsolidationReview = z.infer<typeof consolidationReview>;
export type ConsolidationOperation = z.infer<typeof consolidationOperation>;
export interface PreparedConsolidation { review: ConsolidationReview; payload: string; quoteHashes: string[] }
