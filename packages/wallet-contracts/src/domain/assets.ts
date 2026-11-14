import { AppError, ErrorCode } from "./errors";

export const TOKENS = {
  wNEAR: { symbol: "wNEAR", assetId: "nep141:wrap.near", decimals: 24 },
  // Native NEAR USDC is the sole trading quote asset. Route availability is checked per quote.
  USDC: { symbol: "USDC", assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", decimals: 6 },
} as const;
export const ACTIVE_PAIR = { id: "near-usdc", base: TOKENS.wNEAR, quote: TOKENS.USDC } as const;
// Only reviewed assets are enabled; discovery does not grant execution capability.
export const ASSETS = Object.values(TOKENS);
export function assetById(assetId: string) {
  const asset = ASSETS.find(asset => asset.assetId === assetId);
  if (!asset) throw new AppError(ErrorCode.InvalidTokenBalancesFromNEAR);
  return asset;
}
export function balanceFor(balances: LiveBalances, assetId: string, metadataOverride?: { decimals: number }) {
  const matches = balances.assets.filter(asset => asset.assetId === assetId);
  const metadata = metadataOverride ?? assetById(assetId);
  const match = matches[0];
  if (matches.length !== 1 || !match || match.decimals !== metadata.decimals)
    throw new AppError(ErrorCode.InvalidTokenBalancesFromNEAR);
  return match;
}
export interface LiveBalances {
  accountId: string;
  blockHeight: number;
  checkedAt: number;
  assets: { symbol: string; assetId: string; decimals: number; raw: string; amount: string }[];
}
