import { z } from "zod";

const terms = {
  id: z.uuid(),
  draftId: z.string().min(1),
  assetId: z.string().min(1).max(256).optional(),
  decimals: z.number().int().min(0).max(38).optional(),
  symbol: z.string().optional(),
  internal: z.literal(true).optional(),
  recipient: z.string().regex(/^(?:0x[0-9a-fA-F]{40}|[0-9a-f]{64})$/).refine(value => !/^0x0{40}$/.test(value)),
  rawAmount: z.string().regex(/^[1-9][0-9]{0,37}$/),
  deadline: z.iso.datetime({ offset: true }),
  estimatedRawAmount: z.string().regex(/^[1-9][0-9]{0,37}$/),
};
const proposal = { requestId: z.uuid(), approvalId: z.uuid() };

export const tradingWithdrawalState = z.discriminatedUnion("phase", [
  z.object({ ...terms, phase: z.literal("review") }).strict(),
  z.object({ ...terms, phase: z.literal("proposing") }).strict(),
  z.object({ ...terms, ...proposal, phase: z.literal("awaiting-approval") }).strict(),
  z.object({ ...terms, ...proposal, phase: z.literal("submitted") }).strict(),
  z.object({ ...terms, ...proposal, phase: z.literal("complete"), outcome: z.enum(["settled", "failed", "unknown"]) }).strict(),
]);

export type TradingWithdrawalState = z.infer<typeof tradingWithdrawalState>;
