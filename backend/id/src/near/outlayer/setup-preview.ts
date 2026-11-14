import type { SetupQuotePreview } from "../../../../../packages/wallet-contracts/src/domain/outlayer-quote";
import { estimateSetupBudget } from "./setup-budget";
import { quoteSetupDelivery } from "./setup-delivery";
import { readRelayerReadiness } from "./relayer";

/** No balance is debited; preview remains available before confidential unlock.
 * It is deliberately not an executable, persisted payment authorization. */
export async function previewSetupQuote(input: { asset: "USDC" | "NEAR"; publicKey: string; identity: string; policy?: { walletPublicKey: string; encryptedPolicy: string } }, dependencies = { budget: estimateSetupBudget, delivery: quoteSetupDelivery, relayer: readRelayerReadiness }, now = Date.now()): Promise<SetupQuotePreview> {
  try {
    const relayer = await dependencies.relayer();
    if (relayer.status !== "verified") return { status: "unavailable", asset: input.asset, reason: "Setup relayer is not configured." };
    const budget = await dependencies.budget(input.publicKey, fetch, now, input.policy);
    // A review may disclose this observed provider fee; it grants no authority to
    // charge it. Execution must use a separately approved current fee plan.
    const route = await dependencies.delivery({ asset: input.asset, accountId: input.identity, payer: relayer.accountId, outputYoctoNear: budget.requiredYoctoNear }, process.env.ONE_CLICK_JWT ?? "", fetch, now, undefined, 20);
    return { status: "estimated", asset: input.asset, quotedAt: now, expiresAt: Math.min(budget.costs.expiresAt, route.expiresAt), planHash: budget.planHash,
      costs: budget.costs, controllerReserveYoctoNear: budget.controllerReserveYoctoNear, requiredYoctoNear: budget.requiredYoctoNear,
      maximumPaymentRaw: route.maxInputRaw, paymentDecimals: input.asset === "USDC" ? 6 : 24, deliveryAppFeeBps: route.appFeeBps,
      sourceAssetId: route.sourceAssetId, payer: route.recipient, deliveryKind: "native-near", priceReserved: false, actualPolicyPrepared: budget.actualPolicyPrepared, submissionEnabled: false };
  } catch {
    // Never return arbitrary provider bodies, secrets or RPC diagnostics.
    return { status: "unavailable", asset: input.asset, reason: "Setup estimate is unavailable. No payment has been made. Try again." };
  }
}
