import { unstable_cache } from "next/cache";
import { catalogSchema, DEFAULT_PAIR, makePair, type CatalogAsset } from "../../../../../packages/wallet-contracts/src/domain/catalog";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { ONE_CLICK_BASE, providerFetch } from "./http";

// Opportunistic per-instance cache. Cold starts refetch; no correctness depends on persistence.
export function createCatalogReader(fetcher: typeof fetch = fetch, now = Date.now) {
  let cached: { assets: CatalogAsset[]; until: number } | undefined;
  let pending: Promise<CatalogAsset[]> | undefined;
  return async function read(): Promise<CatalogAsset[]> {
    if (cached && cached.until > now()) return structuredClone(cached.assets);
    if (!pending) pending = (async () => {
      const response = await providerFetch(fetcher, `${ONE_CLICK_BASE}/v0/tokens`);
      if (!response.ok) throw new AppError(ErrorCode.OneClickTokenDiscoveryUnavailable);
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new AppError(ErrorCode.OneClickTokenDiscoveryUnavailable); }
      const parsed = catalogSchema.safeParse(payload);
      if (!parsed.success) throw new AppError(ErrorCode.OneClickTokenDiscoveryUnavailable);
      cached = { assets: parsed.data, until: now() + 300_000 };
      return parsed.data;
    })().finally(() => { pending = undefined; });
    return structuredClone(await pending);
  };
}
export const readCatalog = unstable_cache(async () => createCatalogReader()(), ["one-click-catalog-v1"], { revalidate: 300 });
export async function resolvePair(body: Record<string, unknown>, reader = readCatalog) {
  if (body.baseAssetId === undefined && body.quoteAssetId === undefined) {
    if (body.pairId !== undefined && body.pairId !== DEFAULT_PAIR.id) throw new AppError(ErrorCode.UnsupportedMarketCapability);
    body = { ...body, baseAssetId: DEFAULT_PAIR.base.assetId, quoteAssetId: DEFAULT_PAIR.quote.assetId };
  }
  if (typeof body.baseAssetId !== "string" || typeof body.quoteAssetId !== "string") throw new AppError(ErrorCode.UnsupportedMarketCapability);
  const assets = await reader();
  const base = assets.find(a => a.assetId === body.baseAssetId);
  const quote = assets.find(a => a.assetId === body.quoteAssetId);
  if (!base || !quote || quote.assetId !== DEFAULT_PAIR.quote.assetId || quote.blockchain !== "near" || quote.decimals !== DEFAULT_PAIR.quote.decimals) throw new AppError(ErrorCode.UnsupportedMarketCapability);
  const pair = makePair(base, quote);
  if (body.pairId !== undefined && body.pairId !== pair.id) throw new AppError(ErrorCode.UnsupportedMarketCapability);
  return pair;
}
