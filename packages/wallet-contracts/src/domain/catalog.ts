import { z } from "zod";
import { ACTIVE_PAIR } from "./assets";
import { AppError, ErrorCode } from "./errors";
import { D } from "./decimal";

export const catalogAsset = z.object({
  assetId: z.string().min(1).max(512), symbol: z.string().min(1).max(128),
  decimals: z.number().int().min(0).max(38), blockchain: z.string().min(1).max(64),
  contractAddress: z.string().max(512).optional(), coingeckoId: z.string().optional(),
  // Reviewed metadata override; never substitutes the provider identity in signing checks.
  coingeckoIdOverride: z.string().optional(),
  price: z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(\.\d+)?$/)]).optional(),
  priceUpdatedAt: z.string().optional(),
});
export type CatalogAsset = z.infer<typeof catalogAsset>;
export const catalogSchema = z.array(catalogAsset).min(1).max(20000).superRefine((assets, context) => {
  const ids = new Set<string>();
  for (const asset of assets) {
    if (ids.has(asset.assetId)) context.addIssue({ code: "custom", message: "Duplicate asset ID" });
    ids.add(asset.assetId);
  }
});
export const selectedPairSchema = z.object({ id: z.string(), base: catalogAsset, quote: catalogAsset });
export type SelectedPair = z.infer<typeof selectedPairSchema>;
export const DEFAULT_PAIR: SelectedPair = {
  id: ACTIVE_PAIR.id,
  base: { ...ACTIVE_PAIR.base, blockchain: "near" },
  quote: { ...ACTIVE_PAIR.quote, blockchain: "near" },
};
export function makePair(base: CatalogAsset, quote: CatalogAsset): SelectedPair {
  if (base.assetId === quote.assetId) throw new AppError(ErrorCode.UnsupportedMarketCapability);
  return { id: base.assetId === ACTIVE_PAIR.base.assetId && quote.assetId === ACTIVE_PAIR.quote.assetId
    ? ACTIVE_PAIR.id : JSON.stringify([base.assetId, quote.assetId]), base, quote };
}
export function quantityRaw(quantity: unknown, decimals: number) {
  if (typeof quantity !== "string" || !/^(0|[1-9][0-9]{0,38})(\.[0-9]+)?$/.test(quantity) ||
    (quantity.split(".")[1]?.length ?? 0) > decimals || new D(quantity).lte(0)) throw new AppError(ErrorCode.InvalidAssetQuantity);
  const raw = new D(quantity).mul(new D(10).pow(decimals));
  if (!raw.isInteger() || raw.gt(new D(2).pow(128).minus(1))) throw new AppError(ErrorCode.InvalidAssetQuantity);
  return raw.toFixed(0);
}
