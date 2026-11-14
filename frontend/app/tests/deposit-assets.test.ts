import { expect, it } from "vitest";
import { depositAssets, depositSources, resolveDepositAssets, groupDepositTokens } from "@/lib/near/domain/deposit-assets";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
const usdc = { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" };
const base = { ...usdc, assetId: "base-usdc", blockchain: "base" };
const fake = { ...base, assetId: "fake", coingeckoId: "other" };
it("keeps USDC first and resolves exact network-specific assets", () => {
  expect(depositAssets([base, usdc])[0].assetId).toBe(usdc.assetId);
  expect(depositSources(usdc, [base, usdc, fake])).toEqual([base, usdc]);
  expect(resolveDepositAssets([base, usdc], usdc.assetId, base.assetId)).toEqual({ target: usdc, source: base });
});
it("requires explicit network selection and rejects conversion to another asset", () => {
  expect(() => resolveDepositAssets([usdc], usdc.assetId, "")).toThrow();
  expect(() => resolveDepositAssets([usdc, fake], usdc.assetId, fake.assetId)).toThrow();
});

it("groups non-stablecoin representations without losing their deposit networks", () => {
  const zec = { ...base, symbol: "ZEC", coingeckoId: "zcash", assetId: "zec-base" };
  const eth = { ...zec, blockchain: "eth", assetId: "zec-eth" };
  const pol = { ...zec, blockchain: "pol", assetId: "zec-pol" };
  expect(groupDepositTokens([zec, eth, pol])).toEqual([zec]);
  expect(depositSources(zec, [zec, eth, pol])).toEqual([zec, eth, pol]);
});
it("keeps unrelated tickers, derivatives and missing identities separate", () => {
  const zec = { ...base, symbol: "ZEC", coingeckoId: "zcash", assetId: "zec" };
  const other = { ...zec, coingeckoId: "other", assetId: "other" };
  const wrapped = { ...zec, symbol: "WZEC", assetId: "wrapped" };
  const missing = { ...zec, coingeckoId: "", assetId: "missing" };
  const missing2 = { ...missing, assetId: "missing2" };
  const assets = [zec, other, wrapped, missing, missing2];
  expect(groupDepositTokens(assets)).toEqual(assets);
});
