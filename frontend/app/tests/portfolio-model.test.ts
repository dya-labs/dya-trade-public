import { expect, it } from "vitest";
import { portfolioHoldings } from "@/components/near/portfolio-model";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { getOrders, setOrdersState } from "@/stories/orders/api-mocks";
const quote = DEFAULT_PAIR.quote;
const balance = { ...quote, amount: "10", raw: "10000000" };
it("adds only remaining escrow to wallet balances without counting original order notional", async () => {
  setOrdersState("Mixed");
  const [open, partial] = (await getOrders()).orders;
  const provider = { ...open.provider!, depositedAmount: "4000000", partialFills: [] };
  const first = { ...open, provider };
  const result = portfolioHoldings([balance], [first], [quote], { [quote.assetId]: { price: 1 } });
  expect(result.totalValue).toBe("14");
  expect(result.rows[0]).toMatchObject({ available: "10", committed: "4", amount: "14" });
  const filled = { ...partial, preview: open.preview, provider: { ...provider, fillStatus: "PARTIALLY_FILLED" as const, partialFills: [{ id: "fill", amountIn: "1000000", amountOut: "1" }] } };
  expect(portfolioHoldings([balance], [filled], [quote], { [quote.assetId]: { price: 1 } }).totalValue).toBe("13");
});
it("excludes completed escrow and flags uncertain records", async () => {
  setOrdersState("Mixed");
  const [open] = (await getOrders()).orders;
  for (const change of [{ syncError: "offline" }, { cancelPending: true }, { provider: { ...open.provider!, fillStatus: "FILLED" as const, payoutFinal: false } }]) {
    const result = portfolioHoldings([balance], [{ ...open, ...change }], [quote], {});
    expect(result.rows[0].committed).toBe("0");
    expect(result.unsettled).toBe(1);
  }
  const result = portfolioHoldings([balance], [], [quote], {});
  expect(result.rows[0].value).toBeNull();
  expect(result.unpriced).toBe(1);
});
it("keeps assets on distinct networks separate even with identical tickers", () => {
  const other = { ...balance, assetId: "other-usdc", amount: "2" };
  expect(portfolioHoldings([balance, other], [], [quote], {}).rows).toHaveLength(2);
});

it("values sell escrow in base-token units and rejects duplicate fills", async () => {
  setOrdersState("Mixed");
  const open = (await getOrders()).orders[0];
  const base = DEFAULT_PAIR.base;
  const order = { ...open, preview: { ...open.preview, side: "sell" as const }, provider: { ...open.provider!, inputAsset: base.assetId, depositedAmount: "2000000000000000000000000", partialFills: [] } };
  const result = portfolioHoldings([], [order], [base], { [base.assetId]: { price: 5 } });
  expect(result.rows[0]).toMatchObject({ committed: "2", available: "0", value: "10" });
  const fill = { id: "same-fill", amountIn: "1", amountOut: "1" };
  const invalid = { ...order, provider: { ...order.provider, partialFills: [fill, fill] } };
  expect(portfolioHoldings([], [invalid], [base], {}).unsettled).toBe(1);
});
