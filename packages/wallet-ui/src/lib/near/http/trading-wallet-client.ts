import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { authenticationOptions } from "@dya/wallet-contracts/src/http/schemas/account";
import { z } from "zod";
import { deposit, depositQuote } from "@dya/wallet-contracts/src/http/schemas/transfers";
import { request } from "./request";

export const readTradingTokenBalances = (accountId: string) => request(`outlayer/trading-balances?account=${encodeURIComponent(accountId)}`, z.object({
  balances: z.array(z.object({ token: z.string(), balance: z.string().regex(/^\d+$/) })),
}));

export const readTradingActivity = (accountId: string) => request(`outlayer/trading-activity?account=${encodeURIComponent(accountId)}`, z.object({
  withdrawals: z.array(z.object({
    id: z.string(), createdAt: z.number(), state: z.enum(["settled", "failed", "unknown", "submitted"]),
    amount: z.string(), asset: z.string(), network: z.string(), chain: z.string(),
    assetId: z.string(), address: z.string(), counterpartyAvatarSeed: z.string().optional(), counterpartyIsTrading: z.boolean().optional(), counterpartyName: z.string().optional(),
  })).optional(),
  deposits: z.array(deposit.pick({ id: true, createdAt: true, status: true, creditedAmount: true, originChainTxHashes: true }).extend({
    counterpartyAvatarSeed: z.string().optional(), counterpartyIsTrading: z.boolean().optional(), counterpartyName: z.string().optional(),
    quote: depositQuote.pick({ asset: true, sourceNetwork: true, sourceChain: true, sourceAssetId: true }),
  })).optional(),
  requests: z.array(z.object({ request_id: z.string(), type: z.string(), status: z.string(), created_at: z.string() })),
}));

const policyOptions = z.object({ options: authenticationOptions });
function withdrawalRequest<T>(route: string, schema: z.ZodType<T>, body: unknown, walletId: string, withdrawalId?: string) {
  const params = new URLSearchParams({ account: walletId });
  if (withdrawalId) params.set("withdrawal", withdrawalId);
  return request(`outlayer/${route}?${params}`, schema, body);
}

export function estimateTradingWithdrawal(walletId: string, recipient: string, rawAmount: string) {
  return withdrawalRequest("send-policy/withdrawal-quote", z.object({
    id: z.uuid(),
    estimatedRawAmount: z.string().regex(/^[1-9][0-9]{0,37}$/),
    deadline: z.iso.datetime({ offset: true }),
  }), { recipient, rawAmount }, walletId);
}

export function readTradingWithdrawal(walletId: string, id: string) {
  return withdrawalRequest("send-policy/withdrawal-status", z.object({
    withdrawal: z.object({
      id: z.literal(id),
      state: z.enum(["settled", "failed", "unknown", "submitted"]),
      review: z.object({ amount: z.string(), asset: z.string(), destinationChain: z.enum(["Base", "Confidential Intents"]) }),
    }),
    terminal: z.boolean(),
  }), { id }, walletId);
}

export async function prepareTradingWithdrawalApproval(walletId: string, id: string) {
  await withdrawalRequest("send-policy/withdrawal-proposal", z.object({ phase: z.literal("awaiting-approval") }), { id }, walletId);
  return withdrawalRequest("send-policy/withdrawal-options", policyOptions, { id }, walletId);
}

export function approveTradingWithdrawal(walletId: string, id: string, assertion: AuthenticationResponseJSON) {
  return withdrawalRequest("send-policy/withdrawal-approve", z.object({
    withdrawal: z.object({
      id: z.literal(id), state: z.enum(["submitted", "unknown"]),
      review: z.object({ amount: z.string(), asset: z.string(), destinationChain: z.enum(["Base", "Confidential Intents"]) }),
    }),
  }), "dyaApproval" in assertion ? { dyaApproval: assertion.dyaApproval } : { id, assertion }, walletId, id);
}

export const readTradingOpenOrders = (accountId: string) => request(`outlayer/open-orders?account=${encodeURIComponent(accountId)}`, z.object({
  orders: z.array(z.object({
    order_id: z.string(), base_asset: z.string(), quote_asset: z.string(),
    price: z.union([z.string(), z.number()]), side: z.enum(["buy", "sell"]),
    fill_status: z.string(), is_payout_status_final: z.boolean().optional(),
  })),
}));

export const cancelTradingLimitOrder = (accountId: string, orderId: string) => request(
  `outlayer/cancel-limit-order?account=${encodeURIComponent(accountId)}`,
  z.object({ order_id: z.string(), fill_status: z.string(), is_payout_status_final: z.boolean() }),
  { orderId },
);
