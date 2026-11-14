import { z } from "zod";
import { TOKENS } from "../../../../../packages/wallet-contracts/src/domain/assets";

const raw = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const positiveRaw = raw.refine(value => BigInt(value) > 0n);
const identity = z.string().regex(/^0x[0-9a-f]{40}$/);
const nearAccount = z.string().min(2).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const costsSchema = z.object({
  // These are verified server-side upper bounds, all in yoctoNEAR.
  accountCreation: positiveRaw, policyStorage: positiveRaw, networkFees: positiveRaw,
  expiresAt: z.number().int().positive(),
}).strict();
const routeSchema = z.object({
  sourceAssetId: z.string(), destinationAssetId: z.literal(TOKENS.wNEAR.assetId),
  sourceAccountId: identity, recipient: nearAccount, refundAccountId: identity,
  maxInputRaw: positiveRaw, outputYoctoNear: positiveRaw,
  // Maximum input includes all conversion/delivery fees. Do not add them twice.
  feesIncluded: z.literal(true),
  priceReserved: z.literal(false).default(false),
  appFeeBps: z.number().int().min(0).max(100).default(0),
  appFeeAllocations: z.array(z.object({ recipient: nearAccount, fee: z.number().int().min(0).max(100) }).strict()).max(32).default([]),
  expiresAt: z.number().int().positive(),
}).strict();
const inputSchema = z.object({
  accountId: identity, payer: nearAccount, asset: z.enum(["USDC", "NEAR"]),
  costs: costsSchema, route: routeSchema, availableRaw: raw,
}).strict();

/** Assemble a review from VERIFIED server cost bounds and a validated exact-output
 * delivery route. This does not fetch/validate a provider signature, authorize a
 * payment, or accept client-supplied costs. No executable endpoint uses it yet. */
export function buildSetupQuote(input: z.input<typeof inputSchema>, now = Date.now()) {
  const value = inputSchema.parse(input);
  const { accountId, payer, asset, costs, route } = value;
  if (route.appFeeAllocations.reduce((sum, item) => sum + item.fee, 0) !== route.appFeeBps || new Set(route.appFeeAllocations.map(item => item.recipient)).size !== route.appFeeAllocations.length) throw new Error("Setup delivery fee disclosure is inconsistent.");
  const expiresAt = Math.min(costs.expiresAt, route.expiresAt);
  if (!Number.isSafeInteger(now) || now < 0 || expiresAt <= now) throw new Error("Setup quote expired. Request a new quote.");
  if (route.sourceAccountId !== accountId || route.refundAccountId !== accountId || route.recipient !== payer) throw new Error("Setup payment route does not match this account and payer.");
  const sourceAssetId = asset === "USDC" ? TOKENS.USDC.assetId : TOKENS.wNEAR.assetId;
  if (route.sourceAssetId !== sourceAssetId) throw new Error("Setup payment asset does not match the selected balance.");
  const requiredYoctoNear = (BigInt(costs.accountCreation) + BigInt(costs.policyStorage) + BigInt(costs.networkFees)).toString();
  if (route.outputYoctoNear !== requiredYoctoNear) throw new Error("Setup delivery must match the exact NEAR requirement.");
  if (BigInt(route.maxInputRaw) > BigInt(value.availableRaw)) throw new Error("Insufficient setup payment balance.");
  return {
    network: "mainnet" as const, asset, sourceAssetId, sourceAccountId: accountId,
    payer, refundAccountId: accountId, expiresAt, requiredYoctoNear,
    costs: { accountCreation: costs.accountCreation, policyStorage: costs.policyStorage, networkFees: costs.networkFees },
    maximumPaymentRaw: route.maxInputRaw, paymentDecimals: asset === "USDC" ? 6 : 24,
    deliveryAssetId: TOKENS.wNEAR.assetId, deliveryKind: "native-near" as const, unwrapRequired: false as const,
    deliveryAppFeeBps: route.appFeeBps, deliveryAppFeeAllocations: route.appFeeAllocations, priceReserved: false as const,
    deliveryFeesIncluded: true as const, submissionEnabled: false as const,
  };
}
