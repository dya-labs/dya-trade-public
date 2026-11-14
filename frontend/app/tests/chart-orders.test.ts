import { expect, it } from "vitest";
import { chartOrderLines } from "@/components/near/chart-orders";
import { getOrders, setOrdersState } from "@/stories/orders/api-mocks";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";

it("draws only live orders for the selected exact market with remaining quantities", async () => {
  setOrdersState("Mixed");
  const orders = (await getOrders()).orders;
  const lines = chartOrderLines(orders, DEFAULT_PAIR, "USDC", [], Date.now());
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatchObject({ id: orders[0].id, price: Number(orders[0].preview.price), side: orders[0].preview.side });
  expect(lines[0].text).toContain("limit");
  expect(lines[0].text).toContain("NEAR");
  expect(lines[0].text).not.toContain("wNEAR");
  expect(lines[1].text).not.toBe(lines[0].text);
  expect(chartOrderLines(orders, { ...DEFAULT_PAIR, base: { ...DEFAULT_PAIR.base, assetId: "another-asset" } }, "USDC", [], Date.now())).toEqual([]);
  const open = orders[0];
  for (const change of [{ cancelPending: true }, { syncError: "unavailable" }, { state: "unknown" as const }, { provider: { ...open.provider!, fillStatus: "FILLED" as const, payoutFinal: false } }]) {
    expect(chartOrderLines([{ ...open, ...change }], DEFAULT_PAIR, "USDC", [], Date.now())).toEqual([]);
  }
});
it("converts reference currencies with fresh prices and omits unavailable conversion", async () => {
  setOrdersState("Mixed");
  const order = (await getOrders()).orders[0], now = Date.now();
  const assets = [{ ...DEFAULT_PAIR.quote, price: 0.98, priceUpdatedAt: new Date(now).toISOString() }, { ...DEFAULT_PAIR.quote, assetId: "tether", symbol: "USDT", coingeckoId: "tether", price: 1.01, priceUpdatedAt: new Date(now).toISOString() }];
  expect(chartOrderLines([order], DEFAULT_PAIR, "USDT", assets, now)[0].price).toBeCloseTo(Number(order.preview.price) * 0.98 / 1.01);
  expect(chartOrderLines([order], DEFAULT_PAIR, "USD", assets, now)[0].price).toBeCloseTo(Number(order.preview.price) * 0.98);
  expect(chartOrderLines([order], DEFAULT_PAIR, "USDT", assets, now + 600_001)).toEqual([]);
  expect(chartOrderLines([order], DEFAULT_PAIR, "USDT", [], now)).toEqual([]);
});
