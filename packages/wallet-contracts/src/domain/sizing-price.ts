import type { CatalogAsset } from "./catalog";

/**
 * Indicative quote-token price for sizing only; execution always needs an Intents quote.
 * `live` is a current exchange price for the pair's base, passed only while it is fresh.
 */
export function sizingReferencePrice(
  assetId: string,
  quoteId: string,
  live: { price: number; quote: string } | undefined,
  assets: CatalogAsset[],
  now: number,
): number | null {
  const base = assets.find(asset => asset.assetId === assetId);
  const quote = assets.find(asset => asset.assetId === quoteId);
  if (base && quote && live && live.quote === quote.symbol && Number.isFinite(live.price) && live.price > 0) return live.price;
  const freshPrice = (asset: CatalogAsset | undefined) => {
    const updated = Date.parse(asset?.priceUpdatedAt ?? "");
    const price = Number(asset?.price);
    return Number.isFinite(updated) && updated <= now + 60000 && now - updated < 600000 && Number.isFinite(price) && price > 0 ? price : null;
  };
  // Catalog prices are USD. Divide by the quote asset's USD price; never assume
  // a USDT or USD price is denominated in USDC.
  const quotePrice = freshPrice(quote);
  const basePrice = freshPrice(base);
  if (basePrice === null || quotePrice === null) return null;
  const result = basePrice / quotePrice;
  return Number.isFinite(result) && result > 0 ? result : null;
}
