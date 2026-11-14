import { z } from "zod";

export const text = z.string().min(1);
export const amount = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
export const rawAmount = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const timestamp = z.number().int().nonnegative();
export const side = z.enum(["buy", "sell"]);
export const tokenSymbol = z.enum(["USDC", "wNEAR"]);
export const operationState = z.enum(["signing", "submitted", "unknown", "settled", "failed"]);
export const depositStatus = z.enum(["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"]);
export const ok = z.object({ ok: z.literal(true) });
