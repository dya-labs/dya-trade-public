import { DEFAULT_PAIR, type CatalogAsset } from "./catalog";
import { isSupportedStablecoin } from "./stablecoins";
export function fundingAssets(catalog: CatalogAsset[]) {
  return catalog.filter(a => a.assetId !== DEFAULT_PAIR.quote.assetId && isSupportedStablecoin(a));
}
