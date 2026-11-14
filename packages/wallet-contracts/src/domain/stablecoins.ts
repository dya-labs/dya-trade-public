import type { CatalogAsset } from "./catalog";
// Reviewed USD stable identities. Catalog availability alone does not guarantee
// confidential liquidity; every conversion still requires a validated quote.
const identities: Record<string, readonly string[]> = {
  "usd-coin": ["USDC"], tether: ["USDT"], dai: ["DAI"], frax: ["FRAX"],
  "usd1-wlfi": ["USD1"], "global-dollar": ["USDG"], usdt0: ["USDT0"],
  xdai: ["xDAI"], "falcon-finance": ["USDf"], "usdcx-movement": ["USDCx"],
  "ethena-usde": ["USDe"], "paypal-usd": ["PYUSD"], "usual-usd": ["USD0"],
  "first-digital-usd": ["FDUSD"], "sky-dollar": ["USDS"],
};
export function isSupportedStablecoin(asset: CatalogAsset) {
  return !!asset.coingeckoId && !!identities[asset.coingeckoId]?.includes(asset.symbol);
}
