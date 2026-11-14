import { unstable_cache } from "next/cache";
import { tokenMarketsSchema } from "../../../../../packages/wallet-contracts/src/domain/token-icons";

// The data API refreshes CoinGecko for every 1Click token every 10 minutes with one keyed call
// (backend/data-api `token-markets`). Icons come from that snapshot; Workers never call CoinGecko.
export async function readDataApiIcons(fetcher: typeof fetch = fetch) {
  const response = await fetcher(new URL("/v1/token-markets", process.env.DATA_API_ORIGIN || "http://127.0.0.1:8080"), { redirect: "manual", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Data API token markets unavailable (${response.status})`);
  const { assets } = tokenMarketsSchema.parse(await response.json());
  return Object.fromEntries(Object.entries(assets).flatMap(([assetId, { image }]) => image ? [[assetId, image]] : []));
}
// Throwing during revalidation keeps the last good icons in Next's Data Cache; cold failures show placeholders.
const cachedIcons = unstable_cache(() => readDataApiIcons(), ["data-api-token-icons-v1"], { revalidate: 3600 });
export async function readTokenIcons(): Promise<Record<string, string>> {
  try { return await cachedIcons(); }
  catch (error) {
    console.warn({ event: "token-icons.data-api-unavailable", message: error instanceof Error ? error.message.slice(0, 200) : "unexpected" });
    return {};
  }
}
