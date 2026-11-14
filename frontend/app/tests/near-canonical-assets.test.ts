// @vitest-environment node
import { expect, it } from "vitest";
import { canonicalAssets, displaySymbol } from "@/lib/near/domain/canonical-assets";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
it("selects exact native listings regardless of catalog order, excluding impostors and bridged variants", () => {
  const eth = { assetId: "nep141:eth.omft.near", symbol: "ETH", blockchain: "eth", decimals: 18 };
  const sol = { assetId: "nep141:sol.omft.near", symbol: "SOL", blockchain: "sol", decimals: 9 };
  const btc = { assetId: "nep141:nbtc.bridge.near", symbol: "BTC", blockchain: "near", decimals: 8 };
  const data = [{ ...eth, assetId: "fake" }, { ...sol, blockchain: "aptos", assetId: "bridged" }, { ...btc, assetId: "nep141:btc.omft.near", blockchain: "btc" }, eth, sol, btc, DEFAULT_PAIR.quote];
  expect(canonicalAssets(data).map(a => a.assetId).sort()).toEqual([eth.assetId, sol.assetId, btc.assetId].sort());
  expect(canonicalAssets([...data].reverse())).toEqual(canonicalAssets(data));
  expect(canonicalAssets([{ ...eth, assetId: "missing-native" }])).toEqual([]);
  expect(canonicalAssets([eth, eth])).toEqual([]);
  expect(displaySymbol(DEFAULT_PAIR.base)).toBe("NEAR");
  expect(displaySymbol(sol)).toBe("SOL");
});

import catalogSnapshot from "./fixtures/catalog-identities.json";

it("covers every current catalog identity without collapsing derivatives or ambiguous symbols", () => {
  const assets = canonicalAssets(catalogSnapshot);
  expect(assets).toHaveLength(113);
  expect(new Set(assets.map(a => a.assetId)).size).toBe(assets.length);
  expect(canonicalAssets([...catalogSnapshot].reverse())).toEqual(assets);
  const symbols = new Set(assets.map(a => a.symbol));
  for (const symbol of ["CASHCAT", "BLACKDRAGON", "SHITZU", "WBTC", "cbBTC", "xBTC", "WETH", "stNEAR", "nrUsdt", "steakUSDC"]) {
    expect(symbols.has(symbol), symbol).toBe(true);
  }
  expect(assets.filter(a => a.symbol === "USDCx")).toHaveLength(2);
  expect(assets.filter(a => a.symbol === "sUSDC")).toHaveLength(2);
  expect(assets.filter(a => a.symbol.toLowerCase() === "nearkat")).toHaveLength(2);
  // These explicit aliases/deprecated listings are the only symbols without a
  // base listing. All other distinct symbols must remain discoverable.
  const aliases = new Set(["USDC", "NEAR", "BTC(OMNI)", "wBTC", "XPL_(DEPRECATED)", "USDT0(DEPRECATED)"]);
  for (const asset of catalogSnapshot) {
    expect(symbols.has(asset.symbol) || aliases.has(asset.symbol), asset.assetId).toBe(true);
  }
  expect(symbols.has("USDC")).toBe(false);
  expect(assets.some(a => a.symbol.includes("DEPRECATED"))).toBe(false);
});

it("lists canonical base tokens without stablecoins or wrapped derivatives", async () => {
  const { selectableCanonicalAssets } = await import("@/lib/near/domain/canonical-assets");
  const selected = selectableCanonicalAssets(catalogSnapshot);
  const symbols = selected.map(a => displaySymbol(a));
  expect(symbols).toEqual(expect.arrayContaining(["BTC", "ETH", "NEAR", "SOL", "CASHCAT"]));
  for (const symbol of ["USDT", "DAI", "FRAX", "USDCx", "EURe", "nrUsdt", "WBTC", "cbBTC", "xBTC", "WETH", "stNEAR", "hemiBTC", "wNEARKAT"]) expect(symbols).not.toContain(symbol);
  expect(selectableCanonicalAssets([...catalogSnapshot].reverse())).toEqual(selected);
  expect(canonicalAssets(catalogSnapshot)).toHaveLength(113);
});


it("requires a nonempty CoinGecko ID for Terminal selection without hiding wallet identities", async () => {
  const { selectableCanonicalAssets } = await import("@/lib/near/domain/canonical-assets");
  const btc = catalogSnapshot.find(asset => asset.assetId === "nep141:nbtc.bridge.near")!;
  for (const coingeckoId of [undefined, "", "   "]) {
    const asset = { ...btc, coingeckoId };
    expect(selectableCanonicalAssets([asset])).toEqual([]);
    expect(canonicalAssets([asset])).toEqual([asset]);
  }
  expect(selectableCanonicalAssets([{ ...btc, coingeckoId: "bitcoin" }])).toHaveLength(1);
});


it("excludes the explicitly delisted tokens while retaining their canonical identities", async () => {
  const { selectableCanonicalAssets } = await import("@/lib/near/domain/canonical-assets");
  const removed = ["ABG", "NOEAR", "GNEAR", "TESTNEBULA", "ITLX", "SSC1_PIT"];
  const selected = selectableCanonicalAssets(catalogSnapshot);
  for (const symbol of removed) {
    expect(selected.some(asset => asset.symbol === symbol), symbol).toBe(false);
    expect(canonicalAssets(catalogSnapshot).some(asset => asset.symbol === symbol), symbol).toBe(true);
  }
});

it("uses the NEAR display alias only for the exact wrapped NEAR identity", () => {
  expect(displaySymbol({ assetId: "nep141:wrap.near", symbol: "wNEAR" })).toBe("NEAR");
  expect(displaySymbol({ assetId: "other-token", symbol: "wNEAR" })).toBe("wNEAR");
  expect(DEFAULT_PAIR.base.symbol).toBe("wNEAR");
});
