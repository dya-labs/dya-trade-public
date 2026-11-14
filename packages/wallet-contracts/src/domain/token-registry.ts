import { z } from "zod";
import { DEFAULT_PAIR, type CatalogAsset, type SelectedPair } from "./catalog";
export const tokenIdentitySchema = z.object({
  assetId: z.string().min(1).max(512), symbol: z.string().min(1).max(128), blockchain: z.string().min(1).max(64), decimals: z.number().int().min(0).max(38),
  contractAddress: z.string().max(512), coingeckoId: z.string().max(256),
});
const icon = z.string().max(2048).refine(value => { if (!value) return true; try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } }, "Use an HTTPS image URL");
export const tokenSchema = z.object({
  id: z.string().min(1).max(512), identity: tokenIdentitySchema, observed: tokenIdentitySchema,
  coingeckoIdOverride: z.string().trim().max(256).regex(/^$|^[a-z0-9][a-z0-9-]*$/, "Enter a CoinGecko ID, not a URL").optional(),
  name: z.string().trim().min(1).max(128), iconUrl: icon,
  status: z.enum(["pending", "approved", "disabled"]), trading: z.boolean(), deposits: z.boolean(), withdrawals: z.boolean(),
  discoveredAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
  // When the provider's identity for this token last changed; discovery leaves it alone for a while after.
  observedAt: z.number().int().nonnegative().optional(),
  reviewedAt: z.number().int().nonnegative().optional(), reviewedBy: z.string().optional(),
}).refine(t => t.id === t.identity.assetId && t.id === t.observed.assetId, "Token identity cannot change");
export type TokenRecord = z.infer<typeof tokenSchema>;
export type TokenCapability = "trading" | "deposits" | "withdrawals";
export function tokenIdentity(a: CatalogAsset): z.infer<typeof tokenIdentitySchema> {
  return { assetId: a.assetId, symbol: a.symbol, blockchain: a.blockchain, decimals: a.decimals, contractAddress: a.contractAddress ?? "", coingeckoId: a.coingeckoId?.trim() ?? "" };
}
export function sameTokenIdentity(a: z.infer<typeof tokenIdentitySchema>, b: z.infer<typeof tokenIdentitySchema>) {
  return a.assetId === b.assetId && a.symbol === b.symbol && a.blockchain === b.blockchain && a.decimals === b.decimals && a.contractAddress === b.contractAddress && a.coingeckoId === b.coingeckoId;
}
export function tokenApproved(asset: CatalogAsset, row: TokenRecord | undefined) {
  return row?.status === "approved" && sameTokenIdentity(row.identity, row.observed) && sameTokenIdentity(row.identity, tokenIdentity(asset));
}
export function effectiveCoinGeckoId(row: TokenRecord) {
  return row.coingeckoIdOverride?.trim() || row.identity.coingeckoId;
}
/** Metadata only: provider identity stays intact for discovery and signing guards. */
export function applyTokenMetadata(catalog: readonly CatalogAsset[], tokens: readonly TokenRecord[]): CatalogAsset[] {
  const rows = new Map(tokens.map(row => [row.id, row]));
  return catalog.map(asset => {
    const { coingeckoIdOverride: _untrustedOverride, ...provider } = asset;
    const row = rows.get(asset.assetId);
    return tokenApproved(provider, row) && row?.coingeckoIdOverride
      ? { ...provider, coingeckoIdOverride: row.coingeckoIdOverride } : provider;
  });
}
export function tokenAllowed(asset: CatalogAsset, row: TokenRecord | undefined, capability: TokenCapability) {
  return tokenApproved(asset, row) && !!row?.[capability] && (capability !== "trading" || !!effectiveCoinGeckoId(row));
}
export function selectableTradingAssets(catalog: readonly CatalogAsset[], tokens: readonly TokenRecord[] = []) {
  const rows = new Map(tokens.map(row => [row.id, row]));
  const counts = new Map<string, number>();
  for (const asset of catalog) counts.set(asset.assetId, (counts.get(asset.assetId) ?? 0) + 1);
  return catalog.filter(a => counts.get(a.assetId) === 1 && a.assetId !== DEFAULT_PAIR.quote.assetId && tokenAllowed(a, rows.get(a.assetId), "trading"));
}
export function tradingPairAllowed(pair: SelectedPair, rows: Record<string, TokenRecord> = {}) {
  const quote = rows[pair.quote.assetId];
  return pair.quote.assetId === DEFAULT_PAIR.quote.assetId && tokenAllowed(pair.base, rows[pair.base.assetId], "trading") && quote?.status === "approved" && sameTokenIdentity(quote.identity, tokenIdentity(pair.quote)) && sameTokenIdentity(quote.identity, quote.observed);
}
