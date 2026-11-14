import { feeAllocationSchema, feePlanSchema, feeReceiptSchema, type FeePlan, type FeeReceipt } from "../../../../../packages/wallet-contracts/src/domain/trading-fees";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";

function reject(reason = "invalid_fee_plan", details: Record<string, number | boolean> = {}): never {
  console.warn("trading.fee.verification_failed", { reason, ...details });
  throw new AppError(ErrorCode.TradingFeeVerificationFailed);
}
export function requestedAppFees(value: FeePlan, kind: FeePlan["kind"]) {
  const parsed = feePlanSchema.safeParse(value);
  if (!parsed.success || parsed.data.kind !== kind) return reject();
  const plan = parsed.data;
  return plan.requestedDyaBps ? [{ recipient: plan.recipient, fee: plan.requestedDyaBps }] : [];
}
// Compare the provider's complete normalized allocation list, not the input echo.
// Unknown additional recipients are included in the total; never silently omit them.
export function verifyFeeAllocations(value: unknown, valuePlan: FeePlan): FeeReceipt {
  const parsed = feePlanSchema.safeParse(valuePlan);
  if (!parsed.success || !Array.isArray(value) || value.length > 32) return reject("invalid_allocations");
  const plan = parsed.data, allocations: FeeReceipt["allocations"] = [], seen = new Set<string>();
  for (const [allocationIndex, item] of value.entries()) {
    // Executable quotes may enrich allocations with provider metadata. Validate
    // every financial term, but keep only our canonical receipt fields.
    const candidate = item && typeof item === "object" && !Array.isArray(item)
      ? { recipient: (item as Record<string, unknown>).recipient, fee: (item as Record<string, unknown>).fee }
      : item;
    const allocation = feeAllocationSchema.safeParse(candidate);
    if (!allocation.success) {
      const fields = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      return reject("malformed_allocation", {
        allocationIndex,
        recipientInvalid: allocation.error.issues.some(issue => issue.path[0] === "recipient"),
        feeInvalid: allocation.error.issues.some(issue => issue.path[0] === "fee"),
        unexpectedFields: allocation.error.issues.some(issue => issue.code === "unrecognized_keys"),
        ...(typeof fields.fee === "number" && Number.isFinite(fields.fee) ? { returnedFeeBps: fields.fee } : {}),
      });
    }
    if (seen.has(allocation.data.recipient)) return reject("duplicate_allocation", { allocationIndex });
    seen.add(allocation.data.recipient); allocations.push(allocation.data);
  }
  const totalBps = allocations.reduce((sum, a) => sum + a.fee, 0);
  const dya = allocations.find(a => a.recipient === plan.recipient)?.fee ?? 0;
  if (totalBps > plan.maxTotalBps || dya !== plan.requestedDyaBps) return reject("allocation_mismatch", { totalBps, maxTotalBps: plan.maxTotalBps, dyaBps: dya, requestedDyaBps: plan.requestedDyaBps });
  return { plan, allocations, totalBps };
}
export function verifyQuoteFees(root: Record<string, unknown>, plan: FeePlan): FeeReceipt {
  const echoed = root.quoteRequest as Record<string, unknown> | undefined;
  const quote = root.quote as Record<string, unknown> | undefined;
  // Additional amount-based charges cannot truthfully be folded into a bps total.
  if (!echoed || !quote || quote.refundFee !== "0" || quote.withdrawFee !== "0") return reject("amount_based_fees", { refundFeeZero: quote?.refundFee === "0", withdrawFeeZero: quote?.withdrawFee === "0" });
  try {
    return verifyFeeAllocations(echoed.appFees, plan);
  } catch (error) {
    console.warn("trading.quote.fee_verification_failed", { dry: echoed.dry === true });
    throw error;
  }
}
export function validateFeeReceipt(receipt: FeeReceipt, plan = receipt.plan) {
  const parsed = feeReceiptSchema.safeParse(receipt);
  if (!parsed.success || JSON.stringify(parsed.data.plan) !== JSON.stringify(plan)) return reject();
  const verified = verifyFeeAllocations(parsed.data.allocations, plan);
  if (verified.totalBps !== parsed.data.totalBps) return reject();
  return verified;
}
export function sameFeePlan(a: FeePlan | undefined, b: FeePlan | undefined) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Planning only. Provider ceiling must be established separately for this route.
 * A quote must still verify the actual normalized allocations within that ceiling. */
export function planForDyaFees(policy: import("../../../../../packages/wallet-contracts/src/domain/trading-fees").TradingFeePolicy, kind: FeePlan["kind"], maxProviderBps: number): FeePlan {
  const requestedDyaBps = kind === "market" ? policy.marketDyaBps : policy.limitDyaBps;
  if (!Number.isInteger(maxProviderBps) || maxProviderBps < 0 || maxProviderBps > 500) return reject();
  const plan = { kind, revision: policy.revision, maxTotalBps: requestedDyaBps + maxProviderBps, recipient: policy.recipient, requestedDyaBps };
  const parsed = feePlanSchema.safeParse(plan);
  if (!parsed.success) return reject();
  return parsed.data;
}
