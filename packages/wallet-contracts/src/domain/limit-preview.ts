import type { FeePlan } from "./trading-fees";
import { DEFAULT_PAIR, quantityRaw, type SelectedPair } from "./catalog";
import { balanceFor } from "./assets";
import { AppError, ErrorCode } from "./errors";
import { D } from "./decimal";
import { type LiveBalances } from "./assets";

export function previewLimit(body: Record<string, unknown>, balances: LiveBalances, now = Date.now(), pair: SelectedPair = DEFAULT_PAIR) {
  if (body.pairId !== undefined && body.pairId !== pair.id) throw new AppError(ErrorCode.UnsupportedMarketCapability);
  const baseRaw = quantityRaw(body.quantity, pair.base.decimals);
  const { side, quantity, price, expiryHours } = body;
  if (side !== "buy" && side !== "sell") throw new AppError(ErrorCode.ChooseBuyOrSell);
  for (const [name, value] of [["price", price]] as const) {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,38})(\.[0-9]{1,38})?$/.test(value) || new D(value).lte(0)) throw new AppError(ErrorCode.PositiveLimitValueRequired, name);
  }
  if (![1, 24, 168].includes(expiryHours as number)) throw new AppError(ErrorCode.ChooseASupportedExpiry);
  const qty = new D(quantity as string), p = new D(price as string);
  const quoteRaw = qty.mul(p).mul(new D(10).pow(pair.quote.decimals)).ceil();
  if (quoteRaw.gt(new D(2).pow(128).minus(1))) throw new AppError(ErrorCode.InvalidAssetQuantity);
  const input = side === "buy" ? balanceFor(balances, pair.quote.assetId, pair.quote) : balanceFor(balances, pair.base.assetId, pair.base);
  const requiredRaw = side === "buy" ? quoteRaw : new D(baseRaw);
  return {
    pair,
    submissionEnabled: false as const,
    quantity: qty.toFixed(), price: p.toFixed(), side,
    inputSymbol: input.symbol,
    principal: requiredRaw.div(new D(10).pow(input.decimals)).toFixed(),
    available: input.amount,
    shortfall: D.max(0, requiredRaw.minus(input.raw)).div(new D(10).pow(input.decimals)).toFixed(),
    balanceBlock: balances.blockHeight,
    fees: "Unknown until provider order creation", liquidityVerified: false,
    request: { data: { type: "orders", attributes: {
      orderType: "LIMIT", baseAsset: pair.base.assetId, quoteAsset: pair.quote.assetId,
      quantity: new D(baseRaw).toFixed(0), side: side.toUpperCase(), price: p.toFixed(),
      depositType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS", recipientType: "CONFIDENTIAL_INTENTS",
      refundTo: balances.accountId, recipient: balances.accountId,
      confidentiality: "advanced", timeInForce: "GTC", deadline: new Date(now + (expiryHours as number) * 3600000).toISOString(),
    } } },
  };
}
export type LimitPreview = Omit<ReturnType<typeof previewLimit>, "pair"> & { pair?: SelectedPair; feePlan?: FeePlan };
