import { D } from "./decimal";

/** Indicative size only. The order preview checks the executable amount. */
export function sizeForBalancePercent({ available, percent, side, price, reservePercent = 1, decimals = 6 }: {
  available: string;
  percent: number;
  side: "buy" | "sell";
  price?: string | number | null;
  reservePercent?: number;
  decimals?: number;
}): string {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100 || percent === 0) return "";
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(available)) return "";
  const balance = new D(available);
  if (balance.lte(0)) return "";
  const validPrice = typeof price === "number"
    ? Number.isFinite(price) && price > 0
    : typeof price === "string" && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(price) && new D(price).gt(0);
  if (side === "buy" && !validPrice) return "";
  if (!Number.isFinite(reservePercent) || reservePercent < 0 || reservePercent >= 100) return "";
  const spend = balance.mul(percent).div(100);
  // Market buys can converge against the provider quote; limit buys still need an indicative reserve.
  const quantity = side === "buy" ? spend.mul(new D(100).minus(reservePercent)).div(100).div(new D(price!)) : spend;
  return quantity.toDecimalPlaces(decimals, D.ROUND_DOWN).toFixed();
}

/** Reduce a quoted buy size to fit its actual all-in input, never increasing the requested size. */
export function affordableBuyQuantity({ quantity, available, quotedInput, decimals = 6, percent = 100 }: { quantity: string; available: string; quotedInput: string; decimals?: number; percent?: number }): string {
  if (![quantity, available, quotedInput].every(value => /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value))) return "";
  if (!Number.isInteger(percent) || percent <= 0 || percent > 100) return "";
  const size = new D(quantity), balance = new D(available).mul(percent).div(100), cost = new D(quotedInput);
  if (size.lte(0) || balance.lte(0) || cost.lte(balance)) return "";
  // A small buffer absorbs rounding and quote movement; the next quote remains authoritative.
  const next = size.mul(balance).div(cost).mul("0.999").toDecimalPlaces(decimals, D.ROUND_DOWN);
  return next.gt(0) && next.lt(size) ? next.toFixed() : "";
}
