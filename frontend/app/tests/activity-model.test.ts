import { expect, it } from "vitest";
import { actionableLimit, executionRows, limitSizes, submittedLimit } from "@/components/near/activity-model";
import { getOrders, setOrdersState } from "@/stories/orders/api-mocks";
import { fixtures, setTradesState } from "@/stories/trades/api-mocks";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";

it("separates completed orders while retaining unresolved settlement and cancellation", async () => {
  setOrdersState("Mixed");
  const [open, partial, filled, cancelled, expired] = (await getOrders()).orders;
  expect([open, partial, filled, cancelled, expired].map(actionableLimit)).toEqual([true, true, false, false, false]);
  expect(actionableLimit({ ...filled, provider: { ...filled.provider!, payoutFinal: false } })).toBe(true);
  expect(actionableLimit({ ...filled, syncError: "Unavailable" })).toBe(true);
  expect(actionableLimit({ ...cancelled, cancelPending: true })).toBe(true);
  expect(actionableLimit({ ...filled, provider: { ...filled.provider!, payoutStatus: "FAILED" } })).toBe(true);
  expect(submittedLimit({ ...open, fundingState: undefined, provider: { ...open.provider!, fillStatus: "AWAITING_DEPOSIT", depositedAmount: "0", partialFills: [] } })).toBe(false);
});
it("calculates exact filled and remaining base size for both sides, rejecting overfills", async () => {
  setOrdersState("Mixed");
  const [, partial, filled] = (await getOrders()).orders;
  expect(limitSizes(partial)).toEqual({ filled: "10", remaining: "40" });
  expect(limitSizes(filled)).toEqual({ filled: "125", remaining: "0" });
  expect(limitSizes({ ...filled, provider: { ...filled.provider!, partialFills: [] } })).toEqual({ filled: null, remaining: null });
  expect(limitSizes({ ...filled, provider: { ...filled.provider!, partialFills: [...filled.provider!.partialFills, ...filled.provider!.partialFills] } })).toEqual({ filled: null, remaining: null });
});
it("uses actual market amounts and limit fills, never quotes as execution", async () => {
  setTradesState("Completed");
  const trade = fixtures()[0];
  const old = executionRows([], [trade])[0];
  expect(old).toMatchObject({ input: null, output: null, price: null, unavailable: true, timeIsUpdate: true });
  const actual = executionRows([], [{ ...trade, execution: { inputRaw: "8000000", outputRaw: "2000000000000000000000000", inputAmount: "8", outputAmount: "2", settledAt: 1000 } }])[0];
  expect(actual).toMatchObject({ input: "8", output: "2", size: "2", price: "4", time: 1000, unavailable: false });
  setOrdersState("PartiallyFilled");
  const [order] = (await getOrders()).orders;
  const limit = executionRows([order], [])[0];
  expect(limit).toMatchObject({ type: "Limit", size: "25", price: "4.25", timeIsUpdate: true });
  expect(executionRows([order], [trade], { ...DEFAULT_PAIR, base: { ...DEFAULT_PAIR.base, assetId: "different" } })).toEqual([]);
});
it('retains a confirmed limit execution whose provider no longer returns fill amounts', async () => {
  setOrdersState('Filled');
  const [order] = (await getOrders()).orders;
  expect(executionRows([{ ...order, provider: { ...order.provider!, partialFills: [] } }], [])[0]).toMatchObject({ type: 'Limit', unavailable: true, input: null, output: null, timeIsUpdate: true });
});
