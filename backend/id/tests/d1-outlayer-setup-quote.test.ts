import { expect, test } from "vitest";
import { buildSetupQuote } from "../src/near/outlayer/setup-quote";
import { TOKENS } from "../../../packages/wallet-contracts/src/domain/assets";
const accountId = `0x${"a".repeat(40)}`;
const fixture = (asset: "USDC" | "NEAR" = "USDC") => ({ accountId, payer: "setup.near", asset, availableRaw: "999999999999999999999999999", costs: { accountCreation: "10000000000000000000000", policyStorage: "20000000000000000000000", networkFees: "30000000000000000000000", expiresAt: 2000 }, route: { sourceAssetId: String(asset === "USDC" ? TOKENS.USDC.assetId : TOKENS.wNEAR.assetId), destinationAssetId: TOKENS.wNEAR.assetId, sourceAccountId: accountId, recipient: "setup.near", refundAccountId: accountId, maxInputRaw: asset === "USDC" ? "250000" : "61000000000000000000000", outputYoctoNear: "60000000000000000000000", feesIncluded: true as const, expiresAt: 1800 } });
test.each(["USDC", "NEAR"] as const)("reviews %s using exact asset identity, raw units, earliest expiry and no execution", asset => {
  const quote = buildSetupQuote(fixture(asset), 1000);
  expect(quote).toMatchObject({ asset, expiresAt: 1800, submissionEnabled: false, requiredYoctoNear: "60000000000000000000000", maximumPaymentRaw: fixture(asset).route.maxInputRaw, paymentDecimals: asset === "USDC" ? 6 : 24 });
});
test("rejects expired cost bounds even while delivery remains valid", () => {
  const input = fixture(); input.costs.expiresAt = 1000;
  expect(() => buildSetupQuote(input, 1000)).toThrow("expired");
});
test("binds the source, payer and refund to this setup", () => {
  for (const field of ["sourceAccountId", "refundAccountId", "recipient"] as const) {
    const input = fixture(); input.route[field] = field === "recipient" ? "other.near" : `0x${"b".repeat(40)}`;
    expect(() => buildSetupQuote(input, 1000)).toThrow("does not match");
  }
});
test("rejects a different USDC variant, incomplete output, missing fee inclusion and insufficient balance", () => {
  const wrongToken = fixture(); wrongToken.route.sourceAssetId = "nep141:bridged-usdc.near";
  expect(() => buildSetupQuote(wrongToken, 1000)).toThrow("asset");
  const short = fixture(); short.route.outputYoctoNear = "59999999999999999999999";
  expect(() => buildSetupQuote(short, 1000)).toThrow("exact NEAR");
  const poor = fixture(); poor.availableRaw = "249999";
  expect(() => buildSetupQuote(poor, 1000)).toThrow("Insufficient");
  expect(() => buildSetupQuote({ ...fixture(), route: { ...fixture().route, feesIncluded: false } } as unknown as ReturnType<typeof fixture>, 1000)).toThrow();
});

test("payment selection survives checks and retries and is locked during passkey confirmation", async () => {
  const { nextSetup, setupPresentation } = await import("../../../frontend/id/components/trading-setup-machine");
  const setup = { network: "mainnet", name: "Main", originalUnchanged: true, owner: "unchecked", controllerId: "controller.near", blockers: [], canProvision: false } as const;
  const review = nextSetup({ phase: "loading" }, { type: "loaded", setup: { ...setup, blockers: [] } })!;
  expect(setupPresentation(review).paymentAsset).toBe("USDC");
  const near = nextSetup(review, { type: "payment-asset", asset: "NEAR" })!;
  const checking = nextSetup(near, { type: "check" })!;
  expect(nextSetup(checking, { type: "payment-asset", asset: "USDC" })).toBeUndefined();
  const failed = nextSetup(checking, { type: "failed", message: "Cancelled" })!;
  expect(setupPresentation(nextSetup(failed, { type: "retry" })!).paymentAsset).toBe("NEAR");
  const verified = nextSetup(checking, { type: "loaded", setup: { ...setup, owner: "verified", blockers: [] } })!;
  expect(setupPresentation(verified).paymentAsset).toBe("NEAR");
  expect(setupPresentation(nextSetup(verified, { type: "payment-asset", asset: "USDC" })!).paymentAsset).toBe("USDC");
});

test("retains disclosed live-route fee terms without adding them twice", () => {
  const input = fixture();
  const route = { ...input.route, appFeeBps: 20, appFeeAllocations: [{ recipient: "fees.near", fee: 20 }], priceReserved: false as const };
  expect(buildSetupQuote({ ...input, route }, 1000)).toMatchObject({ maximumPaymentRaw: input.route.maxInputRaw, deliveryAppFeeBps: 20, priceReserved: false });
  expect(() => buildSetupQuote({ ...input, route: { ...route, appFeeBps: 0 } }, 1000)).toThrow("fee disclosure");
});
