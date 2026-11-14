import { z } from "zod";

export const feeKind = z.enum(["market", "limit"]);
export type FeeKind = z.infer<typeof feeKind>;
const bps = z.number().int().min(0).max(500);
// A recipient is an Intents/NEAR account, not a chain-specific withdrawal address.
export const feeRecipient = z.string().max(64).refine(v => v === "" || (v.length >= 2 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(v)));
export const tradingFeePolicySchema = z.object({
  enabled: z.boolean(), // Enabling additionally requires server-side rollout authorization.
  recipient: feeRecipient,
  marketDyaBps: bps,
  limitDyaBps: bps,
  revision: z.number().int().nonnegative(),
}).strict();
export type TradingFeePolicy = z.infer<typeof tradingFeePolicySchema>;
export const DEFAULT_TRADING_FEE_POLICY: TradingFeePolicy = {
  enabled: false, recipient: "dya-trade-treasury.sputnik-dao.near", marketDyaBps: 5, limitDyaBps: 20, revision: 0,
};
export const tradingFeeDisclosureSchema = z.object({
  dyaBps: bps, providerBps: z.null(), totalBps: z.null(), status: z.enum(["disabled", "unverified", "pending"]), message: z.string(),
});
export type TradingFeeDisclosure = z.infer<typeof tradingFeeDisclosureSchema>;
export function feeDisclosure(policy: TradingFeePolicy, kind: FeeKind): TradingFeeDisclosure {
  if (!policy.enabled) return {dyaBps:0,providerBps:null,totalBps:null,status:"disabled",
    message:"DYA fees are off. Provider fees still apply and are included in the provider quote; spread, slippage and price impact are separate."};
  const dyaBps = kind === "market" ? policy.marketDyaBps : policy.limitDyaBps;
  return { dyaBps, providerBps: null, totalBps: null, status: "unverified",
    message: `DYA fee: ${dyaBps} bps (${(dyaBps / 100).toFixed(2)}%), plus provider fees. Provider and total fees are not yet verified; trading is inactive.` };
}

// Server-owned terms for one quote/order. Never construct these from browser input.
// A plan is not authorization to trade; the enabled-policy gate remains separate.
export const feeAllocationSchema = z.object({ recipient: feeRecipient.refine(v => v.length >= 2), fee: bps }).strict();
export const feePlanSchema = z.object({
  kind: feeKind, revision: z.number().int().nonnegative(), maxTotalBps: bps,
  recipient: feeRecipient.refine(v => v.length >= 2), requestedDyaBps: bps,
}).strict().refine(v => v.requestedDyaBps <= v.maxTotalBps);
export type FeePlan = z.infer<typeof feePlanSchema>;
export const feeReceiptSchema = z.object({
  plan: feePlanSchema, allocations: z.array(feeAllocationSchema).max(32), totalBps: bps,
}).strict();
export type FeeReceipt = z.infer<typeof feeReceiptSchema>;
export function feeReceiptSummary(receipt: FeeReceipt) {
  const dya = receipt.plan.requestedDyaBps;
  return `${receipt.totalBps} bps (${(receipt.totalBps / 100).toFixed(2)}%) listed trading fees: DYA ${dya} bps; provider ${receipt.totalBps - dya} bps. Included in the quoted amounts. Spread, slippage and price impact are separate.`;
}

export function pendingFeeDisclosure(plan: FeePlan): TradingFeeDisclosure {
  return {dyaBps:plan.requestedDyaBps,providerBps:null,totalBps:null,status:"pending",
    message:`DYA fee: ${plan.requestedDyaBps} bps, plus provider fees up to ${plan.maxTotalBps-plan.requestedDyaBps} bps. The actual combined fee is verified before funding approval.`};
}
