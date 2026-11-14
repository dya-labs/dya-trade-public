import { z } from "zod";
import type { Network } from "../../../../../packages/wallet-contracts/src/domain/networks";
import { readNetworkIcons } from "./network-icons";

const platformSchema = z.object({ id: z.string(), chain_identifier: z.number().int().positive().nullable(), image: z.object({ small: z.string().optional(), thumb: z.string().optional(), large: z.string().optional() }) });
type Platform = z.infer<typeof platformSchema>;
// Explicit provider aliases; never match display names or token tickers.
const platformIds: Readonly<Record<string, string>> = { eth: "ethereum", bsc: "binance-smart-chain", sol: "solana", near: "near-protocol", arb: "arbitrum-one", op: "optimistic-ethereum", pol: "polygon-pos", avax: "avalanche", hood: "robinhood", bera: "berachain", ton: "the-open-network", xlayer: "x-layer" };
function imageUrl(platform: Platform) {
  for (const value of [platform.image.small, platform.image.thumb, platform.image.large]) {
    if (!value) continue;
    try { const url = new URL(value); if (url.protocol === "https:" && !url.username && !url.password && ["coin-images.coingecko.com", "assets.coingecko.com"].includes(url.hostname)) return value; } catch { /* Ignore invalid metadata. */ }
  }
  return undefined;
}
export function matchNetworkImages(networks: readonly Network[], platforms: readonly Platform[]) {
  return Object.fromEntries(networks.filter(n => !n.iconUrl).flatMap(network => {
    const matches = network.evmChainId !== null
      ? platforms.filter(p => p.chain_identifier === network.evmChainId)
      : platforms.filter(p => p.id === (platformIds[network.id] ?? network.id));
    const image = matches.length === 1 ? imageUrl(matches[0]!) : undefined;
    return image ? [[network.id, image]] : [];
  }));
}
/** Cache only public metadata; failures never prevent reviewing a network. */
export function createNetworkImageReader(fetcher: typeof fetch = fetch, now = Date.now) {
  let cached: Platform[] = [], until = 0, pending: Promise<void> | undefined;
  return async (networks: readonly Network[]): Promise<Record<string, string>> => {
    if (!networks.some(n => !n.iconUrl)) return {};
    if (now() >= until) {
      pending ??= (async () => {
        try {
          const response = await fetcher("https://api.coingecko.com/api/v3/asset_platforms", { redirect: "error", signal: AbortSignal.timeout(4000) });
          if (!response.ok) throw new Error("Network images unavailable");
          cached = z.array(platformSchema).parse(await response.json());
          until = now() + 24 * 60 * 60_000;
        } catch { until = now() + 15 * 60_000; }
      })().finally(() => { pending = undefined; });
      await pending;
    }
    const fallback = await readNetworkIcons();
    return { ...Object.fromEntries(networks.filter(n => !n.iconUrl && fallback[n.id] && (n.evmChainId === null || !cached.length)).map(n => [n.id, fallback[n.id]!])), ...matchNetworkImages(networks, cached) };
  };
}
export const readNetworkImageSuggestions = createNetworkImageReader();
