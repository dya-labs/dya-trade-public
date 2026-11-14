import { z } from "zod";
import { request } from "./request";

const draft = z.object({
  walletId: z.string().optional(), baseAssetId: z.string(), quoteAssetId: z.string(),
  side: z.enum(["buy", "sell"]), base: z.string(), quote: z.string(), size: z.string(),
  sizeUnit: z.enum(["base", "quote"]), limitPrice: z.string(), expiry: z.string(),
});
const reply = z.object({
  text: z.string(),
  draft: draft.optional(),
  checks: z.array(z.object({ id: z.number(), label: z.string(), detail: z.string(), failed: z.boolean() })).optional(),
});

/** A limit order the chat drafted; it is reviewed in the order ticket before anything is placed. */
export type ChatDraft = z.infer<typeof draft>;
type ChatInput = {
  walletId?: string;
  market?: { baseAssetId: string; quoteAssetId: string };
  turnId: string;
  messages: { role: "user" | "assistant"; content: string }[];
};

export const sendChatMessage = (body: ChatInput) => request("jev/chat", reply, body);
