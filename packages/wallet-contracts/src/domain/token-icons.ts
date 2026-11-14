import { z } from "zod";
export const coinGeckoImage = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && ["coin-images.coingecko.com", "assets.coingecko.com"].includes(url.hostname) && !url.username && !url.password;
});
export const tokenIconsSchema = z.record(z.string(), coinGeckoImage);

export const tokenMetadataSchema = z.object({ image: coinGeckoImage.nullable(), price: z.number().nonnegative().nullable(), change24h: z.number().finite().nullable(), volume24h: z.number().nonnegative().nullable(), marketCap: z.number().nonnegative().nullable() });
export type TokenMetadata = z.infer<typeof tokenMetadataSchema>;
/** The data API's `/v1/token-markets` CoinGecko snapshot, keyed by 1Click asset id. */
export const tokenMarketsSchema = z.object({ updatedAt: z.number(), assets: z.record(z.string(), tokenMetadataSchema) });
/** Token market data refreshes every 10 minutes upstream; older than two refreshes counts as delayed. */
export const TOKEN_MARKETS_FRESH_MS = 20 * 60_000;

const projectWebsite = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
});
export const tokenLinksSchema = z.object({ updatedAt: z.number(), assets: z.record(z.string(), z.object({
  website: projectWebsite.nullable(),
  x: z.string().regex(/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/).nullable(),
})) });
