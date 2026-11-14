import { createHash } from "node:crypto";
import { checkPublishedOwnerCode, ownerPlan } from "./owner";
import { estimatePolicyStorage } from "./policy-storage";
import { readSetupNetworkPricing } from "./network-pricing";

// Sizing limits for a preview, NOT permission to execute. The eventual immutable
// execution plan must fit these limits and be re-priced before payment approval.
export const SETUP_BUDGET_LIMITS = {
  version: "setup-budget-v1",
  policyBase64Characters: 4096,
  controllerReserveBytes: 770,
  initializationGas: "32000000000000",
  policyRelayGas: "250000000000000",
  transactionOverheadGas: "18000000000000",
} as const;

/** On-chain prices applied to explicit planning ceilings. No wallet is registered
 * to obtain this estimate; the storage probe sizes the policy capacity, not actual
 * ciphertext. The result is a budget estimate and cannot authorize payment. */
export async function estimateSetupBudget(publicKey: string, fetcher: typeof fetch = fetch, now = Date.now(), policy?: { walletPublicKey: string; encryptedPolicy: string }) {
  const owner = ownerPlan(publicKey);
  await checkPublishedOwnerCode(fetcher);
  const [pricing, storage] = await Promise.all([
    readSetupNetworkPricing(fetcher),
    estimatePolicyStorage(policy ?? { walletPublicKey: "0".repeat(64), encryptedPolicy: Buffer.alloc(SETUP_BUDGET_LIMITS.policyBase64Characters / 4 * 3).toString("base64") }, fetcher),
  ]);
  const controllerReserve = BigInt(pricing.storagePricePerByteYoctoNear) * BigInt(SETUP_BUDGET_LIMITS.controllerReserveBytes);
  const gas = BigInt(SETUP_BUDGET_LIMITS.initializationGas) + BigInt(SETUP_BUDGET_LIMITS.policyRelayGas) + BigInt(SETUP_BUDGET_LIMITS.transactionOverheadGas);
  const networkReserve = gas * BigInt(pricing.gasPurchasePriceYoctoNear);
  const accountCreation = BigInt(pricing.accountCreationChargeYoctoNear) + controllerReserve;
  const expiresAt = now + 60_000;
  const costs = { accountCreation: accountCreation.toString(), policyStorage: storage.yoctoNear, networkFees: networkReserve.toString(), expiresAt };
  const binding = { owner, limits: SETUP_BUDGET_LIMITS, pricing, storage, costs };
  return {
    kind: "budget-estimate" as const, planHash: createHash("sha256").update(JSON.stringify(binding)).digest("hex"),
    controllerId: owner.controllerId, codeHash: owner.codeHash, limits: SETUP_BUDGET_LIMITS,
    costs, controllerReserveYoctoNear: controllerReserve.toString(), creationChargeYoctoNear: pricing.accountCreationChargeYoctoNear,
    requiredYoctoNear: (accountCreation + BigInt(storage.yoctoNear) + networkReserve).toString(),
    pricingBlock: { hash: pricing.blockHash, height: pricing.blockHeight }, storageBlock: { hash: storage.blockHash, height: storage.blockHeight },
    actualPolicyPrepared: !!policy, submissionEnabled: false as const,
  };
}
