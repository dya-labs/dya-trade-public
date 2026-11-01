import type { ClickHouse } from "./clickhouse";
import { prop } from "./json";
import { log } from "./log";
import type { RegistryAsset, RegistrySeed, RegistrySource } from "./registry-types";

export async function readRegistrySeed(): Promise<RegistrySeed> {
  return Bun.file(new URL("../registry/seed.json", import.meta.url)).json();
}

/** A venue's registry symbols. Defaults come from reviewed identities, never from matching a token symbol. */
export async function registrySymbols(venue: string): Promise<string[]> {
  const seed = await readRegistrySeed();
  return [...new Set(seed.assets.flatMap(asset => asset.sources.filter(source => source.venue === venue).map(source => source.symbol)))];
}

export async function persistRegistry(clickhouse: ClickHouse, revision: string): Promise<void> {
  const seed = await readRegistrySeed();
  await clickhouse.insert("registry_assets", seed.assets.map(asset => ({ asset_id: asset.assetId, symbol: asset.symbol, chain: asset.chain, contract: asset.contract, coingecko_id: asset.coinGeckoId, aliases: asset.aliases, unavailable_reason: asset.unavailableReason, revision })));
  await clickhouse.insert("registry_sources", seed.assets.flatMap(asset => asset.sources.map(source => ({ asset_id: asset.assetId, market_id: source.id, venue: source.venue, symbol: source.symbol, base: source.base, quote: source.quote, rank: source.rank, valid_from: String(source.validFrom), valid_to: source.validTo === null ? null : String(source.validTo), coingecko_ticker_url: source.coinGeckoTickerUrl, continuation_of: source.continuationOf, continuation_evidence: source.continuationEvidence ?? null, conversion_ratio: source.conversionRatio, revision }))));
}

export async function loadRegistry(clickhouse: ClickHouse, revision: string): Promise<RegistryAsset[]> {
  const assets = await clickhouse.query<Omit<RegistryAsset, "sources">>(
    "SELECT asset_id AS assetId, symbol, chain, contract, coingecko_id AS coinGeckoId, aliases, unavailable_reason AS unavailableReason FROM registry_assets FINAL WHERE revision = {revision:String} ORDER BY asset_id", { revision });
  const sources = await clickhouse.query<RegistrySource & { assetId: string }>(
    `SELECT asset_id AS assetId, market_id AS id, venue, symbol, base, quote, rank,
      toUnixTimestamp64Milli(valid_from) AS validFrom, toUnixTimestamp64Milli(valid_to) AS validTo,
      coingecko_ticker_url AS coinGeckoTickerUrl, continuation_of AS continuationOf,
      continuation_evidence AS continuationEvidence, toString(conversion_ratio) AS conversionRatio
      FROM registry_sources FINAL WHERE revision = {revision:String} ORDER BY rank, market_id`, { revision });
  return assets.map(asset => ({ ...asset, sources: sources.filter(source => source.assetId === asset.assetId) }));
}

/** The 1Click token catalog could not be read, so runtime price admission can't run. */
export class CatalogUnavailable extends Error {}

/**
 * Fail closed on a missing/stale catalog price, a missing venue ticker, or venue/catalog
 * disagreement above 15%. `prices` holds each market's last price from its venue ticker.
 * Throws `CatalogUnavailable` when the catalog can't be fetched or parsed.
 */
export async function admittedAssets(assets: RegistryAsset[], prices: ReadonlyMap<string, number>): Promise<RegistryAsset[]> {
  let catalog: unknown;
  try {
    const response = await fetch("https://1click.chaindefuser.com/v0/tokens", { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    catalog = await response.json();
  } catch (error) {
    throw new CatalogUnavailable(`1Click token catalog unavailable (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!Array.isArray(catalog)) throw new CatalogUnavailable("1Click token catalog returned invalid data");
  return admitPrices(assets, catalog, prices, Date.now());
}

/**
 * Admission for when 1Click is unreachable and no admission has succeeded yet: the reviewed
 * registry's current sources (and their continuation predecessors) without the runtime price check.
 */
export function unverifiedAssets(assets: RegistryAsset[]): RegistryAsset[] {
  return assets.map(asset => {
    const predecessors = new Set(asset.sources.filter(source => source.validTo === null).map(source => source.continuationOf).filter(Boolean));
    const sources = asset.sources.filter(source => source.validTo === null || predecessors.has(source.id));
    return { ...asset, sources, unavailableReason: sources.length ? null : asset.unavailableReason ?? "No current registry source" };
  });
}

/** Set while 1Click is unreachable; clients show it as a NEAR infrastructure degradation. */
export type Degraded = { cause: "near-intents"; since: number };

/**
 * Keeps markets listed through 1Click outages instead of delisting everything: while the catalog
 * is unreachable it serves the last successful admission (or, before any, `unverifiedAssets`)
 * and reports `degraded`. Other failures propagate and leave the caller's listing untouched.
 */
export class Admission {
  degraded: Degraded | null = null;
  private last: RegistryAsset[] | undefined;

  constructor(private readonly admit: typeof admittedAssets = admittedAssets, private readonly now: () => number = Date.now) {}

  async run(registered: RegistryAsset[], prices: ReadonlyMap<string, number>): Promise<RegistryAsset[]> {
    try {
      const admitted = this.last = await this.admit(registered, prices);
      if (this.degraded) log("api.markets.admission.restored", { since: this.degraded.since });
      this.degraded = null;
      return admitted;
    } catch (error) {
      if (!(error instanceof CatalogUnavailable)) throw error;
      if (!this.degraded) log("api.markets.admission.degraded", { error: error.message, retained: this.last !== undefined }, "warn");
      this.degraded ??= { cause: "near-intents", since: this.now() };
      return this.last ?? unverifiedAssets(registered);
    }
  }
}

export function admitPrices(assets: RegistryAsset[], catalog: unknown[], prices: ReadonlyMap<string, number>, now: number): RegistryAsset[] {
  return assets.map(asset => {
    const token = catalog.find(row => prop(row, "assetId") === asset.assetId);
    const price = Number(prop(token, "price"));
    const updatedAt = prop(token, "priceUpdatedAt");
    const fresh = typeof updatedAt === "string" && Number.isFinite(Date.parse(updatedAt)) && Math.abs(now - Date.parse(updatedAt)) < 15 * 60_000;
    const current = asset.sources.filter(source => {
      const venuePrice = prices.get(source.id);
      return source.validTo === null && fresh && price > 0 && venuePrice !== undefined && venuePrice > 0 && Math.abs(venuePrice / price - 1) <= 0.15;
    });
    const predecessors = new Set(current.map(source => source.continuationOf).filter(Boolean));
    const sources = asset.sources.filter(source => current.includes(source) || (source.validTo !== null && predecessors.has(source.id)));
    return { ...asset, sources, unavailableReason: sources.length ? null : asset.unavailableReason ?? "Runtime price sanity failed or catalog price stale" };
  });
}
