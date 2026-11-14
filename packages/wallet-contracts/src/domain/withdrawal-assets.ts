import type { CatalogAsset } from "./catalog";
import { depositSources } from "./deposit-assets";

export function resolveWithdrawalAssets(catalog: CatalogAsset[], originId: unknown, destinationId: unknown) {
  const origin = catalog.find(a => a.assetId === originId);
  const destination = origin && depositSources(origin, catalog).find(a => a.assetId === destinationId);
  if (!origin || !destination) throw new Error("Choose a supported token and destination network.");
  return { origin, destination };
}
