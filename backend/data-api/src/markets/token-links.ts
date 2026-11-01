import { prop } from "../json";
import type { RedisClient } from "bun";
import { VenueUnavailable, type VenueHttp } from "../venues/http";
import { tokenMarketIds } from "./token-market-ids";

export const TOKEN_LINKS_KEY = "token:links:v1";
export const TOKEN_LINKS_TTL_MS = 24 * 60 * 60_000;
export type TokenLinks = { website: string | null; x: string | null };
export type TokenLinksSnapshot = { updatedAt: number; assets: Record<string, TokenLinks>; mappings?: Record<string, string> };
export function mapTokenLinks(row: unknown): TokenLinks {
  const links = prop(row, "links"), homepages = prop(links, "homepage");
  let website: string | null = null;
  if (Array.isArray(homepages)) for (const value of homepages) {
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !url.username && !url.password) { website = url.href; break; }
    } catch { /* Ignore malformed upstream links. */ }
  }
  const handle = prop(links, "twitter_screen_name");
  return { website, x: typeof handle === "string" && /^[A-Za-z0-9_]{1,15}$/.test(handle) ? `https://x.com/${handle}` : null };
}
/** Daily persistent snapshot; missing links are cached too. Never block the price snapshot. */
export async function refreshTokenLinks({ catalog, markets, redis, now = Date.now }: {
  catalog: Pick<VenueHttp, "get">; markets: Pick<VenueHttp, "get">;
  redis: Pick<RedisClient, "get" | "set">; now?: () => number;
}): Promise<void> {
  const tokens = await catalog.get("");
  if (!Array.isArray(tokens)) throw new Error("Invalid token catalog response");
  // The production reader supplies only DB-approved trading identities.
  const ids = tokenMarketIds(tokens);
  if (!Object.keys(ids).length) throw new Error("No canonical assets in token catalog");
  const cached = await redis.get(TOKEN_LINKS_KEY);
  if (cached) {
    try {
      const previous = JSON.parse(cached) as TokenLinksSnapshot;
      if (JSON.stringify(previous.mappings) === JSON.stringify(ids) && Number.isFinite(previous.updatedAt) && previous.updatedAt <= now() && now() - previous.updatedAt < TOKEN_LINKS_TTL_MS) return;
    } catch { /* Rebuild invalid cached snapshots. */ }
  }
  const links: Record<string, TokenLinks> = {};
  for (const id of new Set(Object.values(ids))) {
    try {
      const row = await markets.get(`/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`);
      if (prop(row, "id") !== id) throw new Error("Invalid CoinGecko metadata response");
      links[id] = mapTokenLinks(row);
    } catch (error) {
      if (error instanceof VenueUnavailable && error.status === 404) links[id] = { website: null, x: null };
      else throw error; // Keep the last complete snapshot on an upstream outage.
    }
  }
  await redis.set(TOKEN_LINKS_KEY, JSON.stringify({ updatedAt: now(), mappings: ids, assets: Object.fromEntries(Object.entries(ids).map(([assetId, id]) => [assetId, links[id]])) }));
}
