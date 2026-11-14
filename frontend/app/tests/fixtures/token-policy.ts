import { tokenIdentity, type TokenRecord } from "../../../../packages/wallet-contracts/src/domain/token-registry";
import type { CatalogAsset } from "../../../../packages/wallet-contracts/src/domain/catalog";
import { selectableCanonicalAssets } from "../../../../packages/wallet-contracts/src/domain/canonical-assets";
// Explicit synthetic approval for legacy UI scenarios. Production never synthesizes approvals.
export function approvedTestTokens(assets: readonly CatalogAsset[]): TokenRecord[] {
  const trading = new Set(selectableCanonicalAssets([...assets]).map(a => a.assetId));
  return assets.map(a => ({ id: a.assetId, identity: tokenIdentity(a), observed: tokenIdentity(a), name: a.symbol, iconUrl: "", status: "approved", trading: trading.has(a.assetId), deposits: true, withdrawals: true, discoveredAt: 0, updatedAt: 0, revision: 0 }));
}
export function withTokenPolicy<T extends { assets: CatalogAsset[] }>(catalog: T) { return { ...catalog, tokens: approvedTestTokens(catalog.assets) }; }
