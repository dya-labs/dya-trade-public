import { expect, it } from "vitest";
import { ACTIVE_PAIR, ASSETS, balanceFor } from "@/lib/near/domain/assets";
import { previewLimit } from "@/lib/near/domain/limit-preview";
import { requireMarketCapability } from "@/lib/near/domain/markets";
const balances = { accountId: "0x" + "a".repeat(40), blockHeight: 1, checkedAt: 1,
  assets: ASSETS.map(asset => ({ ...asset, raw: "0", amount: "0" })) };
it("uses asset IDs even when balance order changes", () => {
  const request = { side: "buy", quantity: "1", price: "4", expiryHours: 24 };
  expect(previewLimit(request, { ...balances, assets: [...balances.assets].reverse() }, 1))
    .toEqual(previewLimit(request, balances, 1));
});
it("fails closed on missing and duplicate balances", () => {
  expect(() => balanceFor({ ...balances, assets: [] }, ACTIVE_PAIR.base.assetId)).toThrow();
  expect(() => balanceFor({ ...balances, assets: [...balances.assets, balances.assets[0]] }, ACTIVE_PAIR.base.assetId)).toThrow();
});
it("token discovery alone cannot enable a market", () => {
  expect(() => requireMarketCapability("unreviewed-token-usdc", "marketOrders")).toThrow();
  expect(() => previewLimit({ pairId: "other", side: "buy" }, balances)).toThrow();
});
