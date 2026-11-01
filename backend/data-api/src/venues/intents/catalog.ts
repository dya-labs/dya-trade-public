import { prop } from "../../json";
import type { RegistrySeed } from "../../registry-types";
import type { Asset } from "./trades";

/** 1Click's public token catalog: every asset ID the verifier settles, with decimals and CoinGecko id. */
export const CATALOG_URL = "https://1click.chaindefuser.com/v0/tokens";
/** Reviewed USD stablecoins form one canonical asset worth $1, so stable ↔ stable flows net out. */
export const USD = "usd";

/** A market's USD source for quote conversion: one of the asset's registry markets, by rank. */
export type QuoteSource = { venue: string; symbol: string; validFrom: number; validTo: number | null };

export type IntentsCatalog = {
  resolve(assetId: string): Asset | undefined;
  /** Every catalog asset ID of a canonical asset (its chain representations). */
  assetIds(group: string): string[];
  /** Charted markets: venue symbol → canonical asset and the registry asset's own catalog id. */
  markets: Map<string, { group: string; assetId: string }>;
  /** Canonical asset → its exchange markets, best rank first, for USD conversion. */
  quotes: Map<string, QuoteSource[]>;
  /** Catalog asset IDs of the reviewed USD stablecoins. */
  stablecoins: ReadonlySet<string>;
};

/**
 * Resolves catalog tokens to canonical assets: reviewed stablecoins (`seed.stablecoins`) to USD,
 * others by CoinGecko id, mapped onto the registry asset that lists it as its id or an alias.
 * Tokens without a CoinGecko id stay unresolved.
 */
export function buildCatalog(tokens: readonly unknown[], seed: RegistrySeed): IntentsCatalog {
  const stablecoins = new Set(seed.stablecoins);
  const canonical = new Map<string, string>();
  for (const asset of seed.assets) {
    if (!asset.coinGeckoId) continue;
    canonical.set(asset.coinGeckoId, asset.coinGeckoId);
    for (const alias of asset.aliases) canonical.set(alias, asset.coinGeckoId);
  }
  const assets = new Map<string, Asset>();
  for (const token of tokens) {
    const assetId = prop(token, "assetId"), decimals = prop(token, "decimals"), cg = prop(token, "coingeckoId");
    if (typeof assetId !== "string" || typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) continue;
    if (stablecoins.has(assetId)) assets.set(assetId, { group: USD, decimals });
    else if (typeof cg === "string" && cg) assets.set(assetId, { group: canonical.get(cg) ?? cg, decimals });
  }
  const markets = new Map<string, { group: string; assetId: string }>(), quotes = new Map<string, QuoteSource[]>();
  for (const asset of seed.assets) {
    if (!asset.coinGeckoId) continue;
    for (const source of asset.sources) {
      if (source.venue === "intents") markets.set(source.symbol, { group: asset.coinGeckoId, assetId: asset.assetId });
      else quotes.set(asset.coinGeckoId, [...quotes.get(asset.coinGeckoId) ?? [], { venue: source.venue, symbol: source.symbol, validFrom: source.validFrom, validTo: source.validTo }]);
    }
  }
  const byGroup = Map.groupBy(assets, ([, asset]) => asset.group);
  return { resolve: assetId => assets.get(assetId), assetIds: group => (byGroup.get(group) ?? []).map(([assetId]) => assetId), markets, quotes, stablecoins };
}
