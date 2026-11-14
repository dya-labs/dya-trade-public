import { expect, it } from "vitest";
import { sizingReferencePrice } from "@/lib/near/domain/sizing-price";
const now = 1800000000000;
const assets = [
  { assetId: "sol", symbol: "SOL", blockchain: "sol", decimals: 9, price: 100, priceUpdatedAt: new Date(now).toISOString() },
  { assetId: "usdc", symbol: "USDC", blockchain: "near", decimals: 6, price: 0.99, priceUpdatedAt: new Date(now).toISOString() },
];
it("uses a live USDC market price for percentage sizing", () => {
  expect(sizingReferencePrice("sol", "usdc", { price: 101, quote: "USDC" }, assets, now)).toBe(101);
});
it("converts USD catalog prices and never treats USDT as USDC", () => {
  expect(sizingReferencePrice("sol", "usdc", { price: 101, quote: "USDT" }, assets, now)).toBeCloseTo(100 / 0.99);
});
it("rejects stale and missing prices instead of sizing with another asset", () => {
  expect(sizingReferencePrice("sol", "usdc", undefined, assets, now + 600001)).toBeNull();
  expect(sizingReferencePrice("btc", "usdc", { price: 101, quote: "USDC" }, assets, now)).toBeNull();
});
