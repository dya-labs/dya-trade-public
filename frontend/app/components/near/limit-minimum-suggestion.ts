import { D } from "@/lib/near/domain/decimal";
import type { SelectedPair, CatalogAsset } from "@/lib/near/domain/catalog";

/** Display guidance only: never modifies the draft or guarantees provider acceptance. */
export function limitMinimumSuggestion(minimumUsd: string, pair: SelectedPair, unit: "base" | "quote", limitPrice: string, now = Date.now()): string | undefined {
  function usd(asset: CatalogAsset) {
    if (asset.price === undefined || !asset.priceUpdatedAt) return;
    const age = now - Date.parse(asset.priceUpdatedAt);
    if (!Number.isFinite(age) || age < 0 || age > 600_000) return;
    const price = new D(asset.price);
    return price.isFinite() && price.gt(0) ? price : undefined;
  }
  try {
    const base = usd(pair.base), quote = usd(pair.quote), price = new D(limitPrice), minimum = new D(minimumUsd);
    if (!base || !quote || !price.isFinite() || !price.gt(0) || !minimum.isFinite() || !minimum.gt(0)) return;
    // Cover both sides' USD valuations at the entered limit, without assuming a stablecoin peg.
    const rate = unit === "base" ? D.min(base, price.mul(quote)) : D.min(quote, base.div(price));
    const decimals = unit === "base" ? pair.base.decimals : pair.quote.decimals;
    const suggested = minimum.div(rate).mul("1.01").toSignificantDigits(2, D.ROUND_UP).toDecimalPlaces(decimals, D.ROUND_UP);
    return suggested.gt(0) ? suggested.toFixed() : undefined;
  } catch { return; }
}
