import { z } from "zod";

export const feedbackInputSchema = z.object({
  id: z.string().uuid(),
  message: z.string().trim().min(3).max(2000),
}).strict();
export const feedbackRecordSchema = z.object({
  kind: z.literal("feedback"), id: z.string().startsWith("feedback:"),
  accountId: z.string().min(1), message: z.string().min(3).max(2000),
  createdAt: z.number().int().nonnegative(),
}).strict();
export type FeedbackRecord = z.infer<typeof feedbackRecordSchema>;
