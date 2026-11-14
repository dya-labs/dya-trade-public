import { DEFAULT_PAIR, type CatalogAsset } from "./catalog";
import { tokenAllowed, type TokenRecord, type TokenCapability } from "./token-registry";
import { isSupportedStablecoin } from "./stablecoins";
import { selectableCanonicalAssets } from "./canonical-assets";

// Only verified catalog identities may be used as destinations. USDC is the
// terminal's quote asset; other assets retain their canonical token identity.
export function depositAssets(catalog: CatalogAsset[], tokens?: readonly TokenRecord[], capability: TokenCapability = "deposits") {
  if (tokens) { const rows = new Map(tokens.map(t => [t.id, t])); return catalog.filter(a => tokenAllowed(a, rows.get(a.assetId), capability)); }
  const usdc = catalog.find(a => a.assetId === DEFAULT_PAIR.quote.assetId);
  return [...new Map([...(usdc ? [usdc] : []), ...catalog.filter(isSupportedStablecoin), ...selectableCanonicalAssets(catalog)].map(a => [a.assetId, a])).values()];
}
// Group picker rows only by catalog identity plus symbol, never ticker alone.
// Keep network-specific assets intact for source selection and quote resolution.
export function depositTokenKey(asset: CatalogAsset): string {
  return asset.coingeckoId?.trim()
    ? JSON.stringify([asset.coingeckoId, asset.symbol])
    : asset.assetId;
}
export function groupDepositTokens(assets: readonly CatalogAsset[]): CatalogAsset[] {
  const groups = new Map<string, CatalogAsset>();
  for (const asset of assets) {
    const key = depositTokenKey(asset);
    if (!groups.has(key)) groups.set(key, asset);
  }
  return [...groups.values()];
}
export function depositSources(target: CatalogAsset, catalog: CatalogAsset[]) {
  return catalog.filter(a => a.assetId === target.assetId ||
    (!!target.coingeckoId && a.coingeckoId === target.coingeckoId && a.symbol === target.symbol));
}
export function resolveDepositAssets(catalog: CatalogAsset[], targetId: unknown, sourceId: unknown, tokens?: readonly TokenRecord[]) {
  const target = depositAssets(catalog, tokens).find(a => a.assetId === targetId);
  const source = target && depositSources(target, catalog).find(a => a.assetId === sourceId);
  if (!target || !source) throw new Error("Choose a supported deposit token and network");
  return { target, source };
}
export const networkName = (chain: string) => ({
  eth: "Ethereum", bsc: "BNB Smart Chain", sol: "Solana", near: "NEAR",
  bera: "Berachain", berachain: "Berachain",
  btc: "Bitcoin", arb: "Arbitrum", base: "Base", pol: "Polygon",
  avax: "Avalanche", op: "Optimism", ton: "TON",
  hood: "Robinhood",
}[chain] ?? chain);
