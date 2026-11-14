import { planForDyaFees } from "./fee-verification";
import { feeDisclosure, tradingFeePolicySchema, DEFAULT_TRADING_FEE_POLICY, type FeePlan, type FeeKind, type TradingFeePolicy } from "../../../../../packages/wallet-contracts/src/domain/trading-fees";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import type { State } from "../repositories/store";

/** Provider allocations above this fixed ceiling fail per-request verification. */
export const MAX_PROVIDER_FEE_BPS = 20;

/** The reviewed DYA fee policy stored with the access records; disabled when none is stored. */
export function tradingFeePolicy(s: State): TradingFeePolicy {
  const r = s.accessRecords?.["trading-fees"];
  if (!r) return { ...DEFAULT_TRADING_FEE_POLICY };
  if (r.kind !== "fee-setting") throw new AppError(ErrorCode.TradingFeeUnverified, "market", 0);
  return tradingFeePolicySchema.parse(r.policy);
}
export function tradingFeeDisclosure(s: State, kind: FeeKind) { return feeDisclosure(tradingFeePolicy(s), kind); }
/** Disabled DYA fees keep provider-only trading. Once enabled,
 * invalid fee plans never fall back to the no-DYA-fee path. */
export function requireVerifiedTradingFees(s: State, kind: FeeKind): FeePlan | undefined {
  const policy = tradingFeePolicy(s);
  if (!policy.enabled) return undefined;
  return planForDyaFees(policy, kind, MAX_PROVIDER_FEE_BPS);
}

/** Check again after asynchronous preparation and inside the signing transaction. */
export function requireCurrentFeePlan(s: State, plan: FeePlan | undefined, kind: FeeKind = plan?.kind ?? "market") {
  const policy = tradingFeePolicy(s);
  if (!plan) {
    if (policy.enabled) throw new AppError(ErrorCode.TradingFeeUnverified, kind, kind === "market" ? policy.marketDyaBps : policy.limitDyaBps);
    return;
  }
  if (plan.maxTotalBps !== plan.requestedDyaBps + MAX_PROVIDER_FEE_BPS || !policy.enabled || policy.revision !== plan.revision || policy.recipient !== plan.recipient ||
      (plan.kind === "market" ? policy.marketDyaBps : policy.limitDyaBps) !== plan.requestedDyaBps)
    throw new AppError(ErrorCode.TradingFeeUnverified, plan.kind, plan.requestedDyaBps);
}
