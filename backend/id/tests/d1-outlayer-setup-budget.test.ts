import { generateKeyPairSync } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { expect, test, vi } from "vitest";
import { estimateSetupBudget, SETUP_BUDGET_LIMITS } from "../src/near/outlayer/setup-budget";
import { PASSKEY_CODE_HASH } from "../src/near/outlayer/owner";
vi.mock("../src/near/outlayer/owner", async original => ({ ...await original<typeof import("../src/near/outlayer/owner")>(), checkPublishedOwnerCode: vi.fn(async () => {}) }));
vi.mock("../src/near/outlayer/network-pricing", () => ({ readSetupNetworkPricing: vi.fn(async () => ({ storagePricePerByteYoctoNear: "10000000000000000000", gasPurchasePriceYoctoNear: "1000000000", accountCreationChargeYoctoNear: "7000000000000000000000", blockHash: "pricing", blockHeight: 1 })) }));
vi.mock("../src/near/outlayer/policy-storage", () => ({ estimatePolicyStorage: vi.fn(async () => ({ yoctoNear: "44180000000000000000000", blockHash: "storage", blockHeight: 2 })) }));
function publicKey() {
  const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" });
  return Buffer.from(isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))], [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))]]))).toString("base64url");
}
test("prices explicit planning ceilings in exact integers and never claims actual policy or payment authority", async () => {
  const budget = await estimateSetupBudget(publicKey(), fetch, 1000);
  expect(budget.costs).toEqual({ accountCreation: "14700000000000000000000", policyStorage: "44180000000000000000000", networkFees: "300000000000000000000000", expiresAt: 61000 });
  expect(budget).toMatchObject({ codeHash: PASSKEY_CODE_HASH, kind: "budget-estimate", actualPolicyPrepared: false, submissionEnabled: false, requiredYoctoNear: "358880000000000000000000" });
  const { estimatePolicyStorage } = await import("../src/near/outlayer/policy-storage");
  expect(vi.mocked(estimatePolicyStorage).mock.calls[0][0].encryptedPolicy).toHaveLength(SETUP_BUDGET_LIMITS.policyBase64Characters);
});
test("binds the budget fingerprint to the user's controller", async () => {
  const first = await estimateSetupBudget(publicKey(), fetch, 1000), second = await estimateSetupBudget(publicKey(), fetch, 1000);
  expect(first.controllerId).not.toBe(second.controllerId);
  expect(first.planHash).not.toBe(second.planHash);
});
