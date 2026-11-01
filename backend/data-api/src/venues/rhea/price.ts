import { decimal, units, volumeUnits } from "../../candles/bar";
import type { OnchainPair } from "../../registry-types";
import type { Trade } from "../types";
import type { Swap } from "./swaps";

const SCALE = 10n ** 18n;

/** Quote tokens whose USD value is our Binance NEARUSDC price (wNEAR) or 1 (USD stablecoins). */
export const QUOTE_USD: Record<string, "near" | "one"> = {
  "wrap.near": "near",
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": "one", // native USDC
  "usdt.tether-token.near": "one",
};
export const NEAR_MARKET = { venue: "binance", symbol: "NEARUSDC" } as const;

const roundDiv = (numerator: bigint, denominator: bigint) => (numerator * 2n + denominator) / (2n * denominator);

/** USD per quote token in 1e-18 units, for the minute: the NEARUSDC close or 1. */
export function quoteRate(pair: OnchainPair, nearClose: string | undefined): bigint | undefined {
  return QUOTE_USD[pair.quote] === "one" ? SCALE : nearClose === undefined ? undefined : units(nearClose);
}

/**
 * A swap of the pair as a trade in USD: price = quote amount / base amount (each scaled by its
 * decimals) × the quote's USD rate, rounded to 1e-18; quantity truncated to 1e-8.
 * Spending the quote token to receive the base token is a taker buy.
 */
export function swapTrade(swap: Swap, pair: OnchainPair, rate: bigint): Trade | undefined {
  const buy = swap.tokenOut === pair.base;
  const [base, quote] = buy ? [swap.amountOut, swap.amountIn] : [swap.amountIn, swap.amountOut];
  const price = roundDiv(quote * 10n ** BigInt(pair.baseDecimals) * rate, base * 10n ** BigInt(pair.quoteDecimals));
  if (price <= 0n) return undefined;
  const quantity = volumeUnits(base * SCALE / 10n ** BigInt(pair.baseDecimals));
  return { time: swap.time, price: decimal(price), quantity: decimal(quantity), count: 1, takerBuy: buy };
}
