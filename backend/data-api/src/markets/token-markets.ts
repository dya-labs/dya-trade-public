import { tokenMarketIds } from "./token-market-ids";
import { refreshTokenLinks } from "./token-links";
import type { Config } from "../config";
import { RedisClient } from "bun";
import { prop } from "../json";
import { log } from "../log";
import { VenueHttp } from "../venues/http";

export const TOKEN_MARKETS_KEY = "token:markets";
export const TOKEN_MARKETS_INTERVAL_MS = 10 * 60_000;
export type TokenMarket = { image: string | null; price: number | null; change24h: number | null; volume24h: number | null; marketCap: number | null };
/** Keyed by 1Click asset id. */
export type TokenMarkets = { updatedAt: number; assets: Record<string, TokenMarket> };

export { tokenMarketIds } from "./token-market-ids";

export function mapTokenMarket(row: unknown): TokenMarket {
  const result: TokenMarket = { image: null, price: null, change24h: null, volume24h: null, marketCap: null };
  const fields: Record<"price" | "change24h" | "volume24h" | "marketCap", string> = {
    price: "current_price", change24h: "price_change_percentage_24h", volume24h: "total_volume", marketCap: "market_cap",
  };
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    const value = prop(row, fields[key]);
    if (typeof value === "number" && Number.isFinite(value) && (key === "change24h" || value >= 0)) result[key] = value;
  }
  const image = prop(row, "image");
  if (typeof image === "string") {
    try {
      const url = new URL(image);
      if (url.protocol === "https:" && ["coin-images.coingecko.com", "assets.coingecko.com"].includes(url.hostname) && !url.username && !url.password) result.image = image;
    } catch { /* Invalid upstream image URLs remain null. */ }
  }
  return result;
}

/** A single SET publishes all batches together; failures never replace the last good snapshot. */
export async function refreshTokenMarkets(options: {
  catalog: Pick<VenueHttp, "get">;
  markets: Pick<VenueHttp, "get">;
  redis: Pick<RedisClient, "set">;
  now?: () => number;
}): Promise<TokenMarkets> {
  const tokens = await options.catalog.get("");
  if (!Array.isArray(tokens)) throw new Error("Invalid token catalog response");
  const assetIds = tokenMarketIds(tokens);
  const ids = [...new Set(Object.values(assetIds))].sort();
  const coins: Record<string, TokenMarket> = {};
  for (let offset = 0; offset < ids.length; offset += 250) {
    const batch = ids.slice(offset, offset + 250);
    const query = new URLSearchParams({ vs_currency: "usd", ids: batch.join(","), per_page: "250" });
    const rows = await options.markets.get(`/coins/markets?${query}`);
    if (!Array.isArray(rows)) throw new Error("Invalid CoinGecko markets response");
    for (const row of rows) {
      const id = prop(row, "id");
      if (typeof id !== "string" || !batch.includes(id)) throw new Error("Invalid CoinGecko market id");
      coins[id] = mapTokenMarket(row);
    }
  }
  const assets = Object.fromEntries(Object.entries(assetIds).flatMap(([assetId, id]) => coins[id] ? [[assetId, coins[id]]] : []));
  const snapshot = { updatedAt: (options.now ?? Date.now)(), assets };
  await options.redis.set(TOKEN_MARKETS_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export async function runTokenMarkets(config: Config): Promise<() => Promise<void>> {
  if (!config.idCatalogUrl) throw new Error("token-markets requires DYA_ID_CATALOG_URL");
  const redis = new RedisClient(config.redisUrl);
  await redis.connect();
  const reader = new VenueHttp({ venue: "reviewed-token-catalog", url: config.idCatalogUrl, budget: 12 });
  const readReviewedCatalog = async () => {
    const assets = prop(await reader.get(""), "assets");
    if (!Array.isArray(assets) || assets.some(a => typeof prop(a, "assetId") !== "string" || typeof prop(a, "trading") !== "boolean")) throw new Error("Invalid reviewed ID metadata catalog");
    return assets;
  };
  const catalog = { get: readReviewedCatalog };
  const listedCatalog = { get: async () => (await readReviewedCatalog()).filter(a => prop(a, "trading") === true) };
  const markets = new VenueHttp({ venue: "coingecko", url: "https://api.coingecko.com/api/v3", budget: 30,
    headers: config.coinGeckoApiKey ? { "x-cg-demo-api-key": config.coinGeckoApiKey } : undefined });
  let pending: Promise<void> | undefined;
  let linksPending: Promise<void> | undefined;
  const tick = () => {
    if (!linksPending) linksPending = refreshTokenLinks({ catalog: listedCatalog, markets, redis }).catch(error => {
      log("token.links.failed", { error: String(error) }, "warn");
    }).finally(() => { linksPending = undefined; });
    if (pending) return;
    pending = refreshTokenMarkets({ catalog, markets, redis }).then(snapshot => {
      log("token.markets.updated", { updatedAt: snapshot.updatedAt, assets: Object.keys(snapshot.assets).length });
    }).catch(error => {
      log("token.markets.failed", { error: String(error) }, "warn");
    }).finally(() => { pending = undefined; });
  };
  tick();
  const timer = setInterval(tick, TOKEN_MARKETS_INTERVAL_MS);
  return async () => {
    clearInterval(timer);
    await Promise.all([pending, linksPending]);
    redis.close();
  };
}
