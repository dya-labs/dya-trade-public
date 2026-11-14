import { expect, test, vi } from "vitest";
import { previewSetupQuote } from "../src/near/outlayer/setup-preview";
import { nextSetup } from "../../../frontend/id/components/trading-setup-machine";
import { TOKENS } from "../../../packages/wallet-contracts/src/domain/assets";
const input = { asset: "USDC" as const, publicKey: "server-public-key", identity: `0x${"a".repeat(40)}` };
function dependencies() {
  return {
    relayer: vi.fn(async () => ({ status: "verified" as const, accountId: "payer.near", publicKey: "public", nativeBalanceYoctoNear: "1000000000000000000000000", blockHash: "block", blockHeight: 1, submissionEnabled: false as const })),
    budget: vi.fn(async () => ({ kind: "budget-estimate" as const, planHash: "plan", controllerId: "controller.near", codeHash: "code", limits: { version: "setup-budget-v1", policyBase64Characters: 4096, controllerReserveBytes: 770, initializationGas: "32000000000000", policyRelayGas: "250000000000000", transactionOverheadGas: "18000000000000" } as const, costs: { accountCreation: "10", policyStorage: "20", networkFees: "30", expiresAt: 2000 }, controllerReserveYoctoNear: "3", creationChargeYoctoNear: "7", requiredYoctoNear: "60", pricingBlock: { hash: "block", height: 1 }, storageBlock: { hash: "block", height: 1 }, actualPolicyPrepared: false as const, submissionEnabled: false as const })),
    delivery: vi.fn(async () => ({ sourceAssetId: TOKENS.USDC.assetId, destinationAssetId: TOKENS.wNEAR.assetId, sourceAccountId: input.identity, recipient: "payer.near", refundAccountId: input.identity, maxInputRaw: "250000", outputYoctoNear: "60", feesIncluded: true as const, expiresAt: 1800, appFeeBps: 20, appFeeAllocations: [{ recipient: "fee.near", fee: 20 }], priceReserved: false as const })),
  };
}
test("joins server-bound mainnet budget and signed dry route as a non-payable estimate", async () => {
  const deps = dependencies();
  expect(await previewSetupQuote(input, deps, 1000)).toMatchObject({ status: "estimated", expiresAt: 1800, maximumPaymentRaw: "250000", deliveryAppFeeBps: 20, submissionEnabled: false, actualPolicyPrepared: false });
  expect(deps.delivery).toHaveBeenCalledWith(expect.objectContaining({ payer: "payer.near", accountId: input.identity, outputYoctoNear: "60" }), expect.any(String), fetch, 1000, undefined, 20);
});
test("sanitizes provider failures and never returns a partial payable price", async () => {
  const deps = dependencies(); deps.delivery.mockRejectedValue(new Error("private-provider-response"));
  const result = await previewSetupQuote(input, deps, 1000);
  expect(result.status).toBe("unavailable"); expect(JSON.stringify(result)).not.toContain("private-provider-response");
});
test("asset switching invalidates estimates and ignores late responses even after switching back", async () => {
  const quote = await previewSetupQuote(input, dependencies(), 1000);
  const setup = { network: "mainnet", name: "Main", originalUnchanged: true, owner: "verified", controllerId: "controller.near", blockers: [], canProvision: false } as const;
  let state = nextSetup({ phase: "loading" }, { type: "loaded", setup: { ...setup, blockers: [] } })!;
  state = nextSetup(state, { type: "quote", id: "old" })!;
  state = nextSetup(state, { type: "payment-asset", asset: "NEAR" })!;
  state = nextSetup(state, { type: "payment-asset", asset: "USDC" })!;
  state = nextSetup(state, { type: "quote", id: "new" })!;
  expect(nextSetup(state, { type: "quoted", id: "old", quote, now: 1000 })).toBeUndefined();
  state = nextSetup(state, { type: "quoted", id: "new", quote, now: 1000 })!;
  expect(state.quote?.phase).toBe("ready");
  expect(nextSetup(state, { type: "quote-expired", planHash: "plan", now: 1799 })).toBeUndefined();
  state = nextSetup(state, { type: "quote-expired", planHash: "plan", now: 1800 })!;
  expect(state.quote?.phase).toBe("expired");
});
