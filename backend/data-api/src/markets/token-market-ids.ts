import { prop } from "../json";

/** CoinGecko id per 1Click asset id. Wrapped NEAR shows NEAR's market, matching the Terminal's NEAR label. */
export function tokenMarketIds(tokens: readonly unknown[]): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const token of tokens) {
    const assetId = prop(token, "assetId");
    const id = prop(token, "coingeckoIdOverride") || (assetId === "nep141:wrap.near" ? "near" : prop(token, "coingeckoId"));
    if (typeof assetId === "string" && assetId && typeof id === "string" && /^[a-z0-9-]+$/.test(id)) ids[assetId] = id;
  }
  return ids;
}

