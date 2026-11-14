import { DEFAULT_TRADING_FEE_POLICY } from "../../../packages/wallet-contracts/src/domain/trading-fees";
// @vitest-environment node
import { expect, it, vi } from "vitest";
import { planForDyaFees, requestedAppFees, verifyFeeAllocations, verifyQuoteFees, validateFeeReceipt } from "../../../backend/id/src/near/services/fee-verification";
import { requireCurrentFeePlan } from "../../../backend/id/src/near/services/trading-fees";
import { emptyState } from "../../../backend/id/src/near/repositories/store";
import type { FeePlan } from "../../../packages/wallet-contracts/src/domain/trading-fees";
const plan: FeePlan = { kind: "market", revision: 3, maxTotalBps: 25, recipient: "dya-trade-treasury.sputnik-dao.near", requestedDyaBps: 5 };
const allocations = [{ recipient: plan.recipient, fee: 5 }, { recipient: "provider.near", fee: 20 }];
it("counts provider allocations and rejects a user-total target below the returned fee", () => {
  expect(verifyFeeAllocations(allocations, plan).totalBps).toBe(25);
  expect(() => verifyFeeAllocations(allocations, { ...plan, maxTotalBps: 5 })).toThrow();
  expect(() => verifyFeeAllocations([{ recipient: plan.recipient, fee: 20 }, { recipient: "provider.near", fee: 20 }], { ...plan, requestedDyaBps: 20, maxTotalBps: 20 })).toThrow();
});
it("rejects missing, malformed, duplicate, fractional, negative or redirected allocations", () => {
  for (const bad of [undefined, {}, [{recipient: plan.recipient, fee: 0.5}], [{recipient: plan.recipient, fee: -1}], [...allocations, allocations[0]], [{recipient: "wrong.near", fee: 5}], [...allocations, {recipient: "extra.near", fee: 1}]])
    expect(() => verifyFeeAllocations(bad, plan)).toThrow();
});
it("requests zero app fees explicitly without assuming zero provider fees", () => {
  const zero = {...plan, requestedDyaBps:0, maxTotalBps:20};
  expect(requestedAppFees(zero,"market")).toEqual([]);
  expect(verifyFeeAllocations([{recipient:"provider.near",fee:20}],zero).totalBps).toBe(20);
  expect(() => requestedAppFees(plan,"limit")).toThrow();
});
it("requires zero amount-based extra charges and rejects a tampered receipt", () => {
  const root={quoteRequest:{appFees:allocations},quote:{withdrawFee:"0",refundFee:"0"}};
  const receipt=verifyQuoteFees(root,plan);
  expect(validateFeeReceipt(receipt)).toEqual(receipt);
  expect(()=>verifyQuoteFees({...root,quote:{withdrawFee:"1",refundFee:"0"}},plan)).toThrow();
  expect(()=>verifyQuoteFees({...root,quote:{}},plan)).toThrow();
  expect(()=>validateFeeReceipt({...receipt,totalBps:5})).toThrow();
  expect(()=>validateFeeReceipt(receipt,{...plan,revision:4})).toThrow();
});
it("disabled policy cannot authorize an earlier fee-backed snapshot, but allows provider-only preparation", () => {
  expect(()=>requireCurrentFeePlan(emptyState(),undefined)).not.toThrow();
  expect(()=>requireCurrentFeePlan(emptyState(),plan)).toThrow();
});

it("adds DYA fees to an independently established provider ceiling",()=>{
  const market=planForDyaFees(DEFAULT_TRADING_FEE_POLICY,"market",20);
  expect(market).toMatchObject({maxTotalBps:25,requestedDyaBps:5});
  const limit=planForDyaFees(DEFAULT_TRADING_FEE_POLICY,"limit",20);
  expect(limit).toMatchObject({maxTotalBps:40,requestedDyaBps:20});
  expect(requestedAppFees(limit,"limit")).toEqual([{recipient:limit.recipient,fee:20}]);
  expect(()=>planForDyaFees(DEFAULT_TRADING_FEE_POLICY,"market",-1)).toThrow();
});

it("distinguishes malformed fields from duplicates without logging recipient data", () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(() => verifyFeeAllocations([{recipient: "private-recipient.near", fee: 2.5}], plan)).toThrow();
    expect(warning).toHaveBeenLastCalledWith("trading.fee.verification_failed", {
      reason: "malformed_allocation", allocationIndex: 0, recipientInvalid: false, feeInvalid: true, unexpectedFields: false, returnedFeeBps: 2.5,
    });
    expect(() => verifyFeeAllocations([...allocations, allocations[0]], plan)).toThrow();
    expect(warning).toHaveBeenLastCalledWith("trading.fee.verification_failed", { reason: "duplicate_allocation", allocationIndex: 2 });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private-recipient");
  } finally { warning.mockRestore(); }
});

it("normalizes enriched executable allocations without relaxing financial checks", () => {
  const enriched = allocations.map(allocation => ({ ...allocation, providerMetadata: { source: "executable-quote" } }));
  const receipt = verifyQuoteFees({ quoteRequest: { dry: false, appFees: enriched }, quote: { refundFee: "0", withdrawFee: "0" } }, plan);
  expect(receipt.allocations).toEqual(allocations);
  expect(receipt.totalBps).toBe(25);
  expect(validateFeeReceipt(receipt)).toEqual(receipt);
  expect(() => verifyFeeAllocations([...enriched, enriched[0]], plan)).toThrow();
  expect(() => verifyFeeAllocations([{ ...enriched[0], fee: "5" }, enriched[1]], plan)).toThrow();
  expect(() => verifyFeeAllocations([{ ...enriched[0], fee: 5.5 }, enriched[1]], plan)).toThrow();
  expect(() => verifyFeeAllocations([{ ...enriched[0], recipient: "wrong.near" }, enriched[1]], plan)).toThrow();
  expect(() => verifyFeeAllocations([enriched[0], { ...enriched[1], fee: 21 }], plan)).toThrow();
});
