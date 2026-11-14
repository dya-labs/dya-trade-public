import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { request } from "./request";
import { authenticationOptions } from "./schemas/account";
import * as schema from "./schemas/trading";

type MarketInput = { quoteAmount?: string; slippage?: schema.SlippageSettings; baseAssetId?: string; quoteAssetId?: string; side: "buy" | "sell"; quantity: string };
type LimitInput = MarketInput & { price: string; expiryHours: number };
/**
 * `fast` asks for a shorter solver-collection window: the quick quote of an input, requested
 * together with the full-window one. `quoteReference`: the ticket's name for the input; the wallet
 * server holds that input's latest quote under it for Review.
 */
export const previewMarketOrder = (body: MarketInput & { quoteReference?: string }, signal?: AbortSignal, fast = false) => request("live/preview", schema.marketPreview, { ...body, orderType: "market", reusable: true, ...(fast ? { fast: true } : {}) }, signal);
export const previewLimitOrder = (body: LimitInput, signal?: AbortSignal) => request("live/preview", schema.limitPreview, { ...body, orderType: "limit" }, signal);
/** A hosted ID approval flow created with the prepared ceremony (`walletFlow: true`), for opening ID without another request. */
const walletFlow = z.object({ url: z.url(), flowId: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expires: z.number().int().positive() }).optional();
export const prepareMarketOrder = (body: MarketInput & { quoteReference?: string; walletFlow?: true }) => request("live/market/prepare", z.object({ options: authenticationOptions, review: schema.marketReview, walletFlow }), body);
export const prepareLimitOrder = (body: LimitInput & { requestId: string; walletFlow?: true }) => request("live/orders/prepare", z.object({ options: authenticationOptions, review: schema.executableLimitReview, walletFlow }), body);
export const submitLimitOrder = (body: AuthenticationResponseJSON) => request("live/orders/submit", z.object({ order: schema.order }), body);
export const submitMarketOrder = (body: AuthenticationResponseJSON) => request("live/market/submit", z.object({ trade: schema.trade }), body);
export const getOrders = (signal?: AbortSignal) => request("live/orders", z.object({ orders: z.array(schema.order) }), undefined, signal);
export const getOrderStatus = (id: string, signal?: AbortSignal) => request("live/orders/status", z.object({ order: schema.order }), { id }, signal);
export const cancelOrder = (id: string) => request("live/orders/cancel", z.object({ order: schema.order }), { id });
export const getMarketTrades = (signal?: AbortSignal) => request("live/trades", z.object({ trades: z.array(schema.trade) }), undefined, signal);
export const getMarketTradeStatus = (id: string, signal?: AbortSignal) => request("live/trades/status", z.object({ trade: schema.trade }), { id }, signal);

export const abandonLimitOrder = (requestId: string) => request("live/orders/abandon", z.object({ ok: z.literal(true) }), { requestId });
