import { z } from "zod";
import { verifyQuoteSignature, type OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { TOKENS } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { providerFetch, ONE_CLICK_BASE, oneClickHeaders } from "../providers/http";

const positive = z.string().regex(/^[1-9][0-9]{0,77}$/);
const nearAccount = z.string().min(2).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const inputSchema = z.object({ asset: z.enum(["USDC", "NEAR"]), accountId: z.string().regex(/^0x[0-9a-f]{40}$/), payer: nearAccount, outputYoctoNear: positive }).strict();

/** Read-only dry quote. The wrap.near catalog asset is paid out as native
 * NEAR on DESTINATION_CHAIN. Verify actual native settlement before setup.
 * No intent generation, deposit allocation, signing or broadcast. */
async function collectSetupDelivery(input: z.input<typeof inputSchema>, jwt: string, fetcher: typeof fetch = fetch, now = Date.now(), verify = verifyQuoteSignature, maxAppFeeBps = 0, mode: "preview" | "payment" = "preview") {
  const value = inputSchema.parse(input);
  if (!Number.isInteger(maxAppFeeBps) || maxAppFeeBps < 0 || maxAppFeeBps > 100) throw new Error("Invalid setup delivery fee ceiling.");
  if (!jwt.trim()) throw new Error("Setup delivery quotes are not configured.");
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid quote time.");
  const request = {
    dry: mode === "preview", confidentiality: "advanced", swapType: "EXACT_OUTPUT", slippageTolerance: 100,
    originAsset: value.asset === "USDC" ? TOKENS.USDC.assetId : TOKENS.wNEAR.assetId,
    destinationAsset: TOKENS.wNEAR.assetId, amount: value.outputYoctoNear,
    depositType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS", refundTo: value.accountId,
    recipientType: "DESTINATION_CHAIN", recipient: value.payer,
    deadline: new Date(now + 300_000).toISOString(), quoteWaitingTimeMs: 3000,
    appFees: [],
  } as const;
  const response = await providerFetch(fetcher, `${ONE_CLICK_BASE}/v0/quote`, { method: "POST", headers: oneClickHeaders(jwt), body: JSON.stringify(request) });
  if (!response.ok) throw new Error("Setup delivery quote is unavailable.");
  const result = z.object({ timestamp: z.string(), quoteRequest: z.record(z.string(), z.unknown()), quote: z.object({ amountIn: positive, amountOut: positive, minAmountOut: positive, deadline: z.string().optional(), depositAddress: z.unknown().optional(), depositMemo: z.unknown().optional() }).passthrough() }).passthrough().parse(await response.json());
  for (const [key, expected] of Object.entries(request)) {
    if (key === "appFees") {
      if (result.quoteRequest.appFees !== undefined && !Array.isArray(result.quoteRequest.appFees)) throw new Error("Unexpected setup payment fee.");
    } else if (result.quoteRequest[key] !== expected) throw new Error("Setup quote does not match the requested route.");
  }
  if (mode === "preview" && (result.quote.depositAddress != null || result.quote.depositMemo != null)) throw new Error("Setup preview returned executable deposit instructions.");
  if (mode === "payment" && (typeof result.quote.depositAddress !== "string" || !/^[a-zA-Z0-9._:-]{2,256}$/.test(result.quote.depositAddress) || result.quote.depositMemo != null)) throw new Error("Invalid setup payment deposit instructions.");
  if (!verify(result as unknown as OneClickQuoteResponse)) throw new Error("Setup quote signature is invalid.");
  if (result.quote.amountOut !== value.outputYoctoNear || result.quote.minAmountOut !== value.outputYoctoNear) throw new Error("Setup quote does not guarantee the required native NEAR amount.");
  const allocations = z.array(z.object({ recipient: z.string().min(2).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/), fee: z.number().int().min(0).max(100) })).max(32).parse(result.quoteRequest.appFees ?? []);
  const appFeeBps = allocations.reduce((sum, allocation) => sum + allocation.fee, 0);
  if (new Set(allocations.map(item => item.recipient)).size !== allocations.length || appFeeBps > maxAppFeeBps) throw new Error("Unexpected setup payment fee.");
  // Dry prices are not reserved. Apply a short local freshness window to the
  // provider-signed timestamp; recollect an executable quote before payment.
  const quotedAt = Date.parse(result.timestamp);
  if (!Number.isFinite(quotedAt) || quotedAt > now + 5_000) throw new Error("Invalid setup quote timestamp.");
  const expiresAt = Math.min(quotedAt + 60_000, Date.parse(request.deadline), result.quote.deadline ? Date.parse(result.quote.deadline) : Infinity);
  if (!Number.isFinite(expiresAt) || expiresAt <= now + 15_000) throw new Error("Setup quote expires too soon.");
  return { ...(mode === "payment" ? { depositAddress: result.quote.depositAddress as string } : {}), sourceAssetId: request.originAsset, destinationAssetId: TOKENS.wNEAR.assetId, sourceAccountId: value.accountId, recipient: value.payer, refundAccountId: value.accountId, maxInputRaw: result.quote.amountIn, outputYoctoNear: result.quote.amountOut, feesIncluded: true as const, expiresAt, appFeeBps, appFeeAllocations: allocations, priceReserved: false as const };
}

export function quoteSetupDelivery(input: z.input<typeof inputSchema>, jwt: string, fetcher: typeof fetch = fetch, now = Date.now(), verify = verifyQuoteSignature, maxAppFeeBps = 0) {
  return collectSetupDelivery(input, jwt, fetcher, now, verify, maxAppFeeBps, "preview");
}
export function executableSetupDelivery(input: z.input<typeof inputSchema>, jwt: string, fetcher: typeof fetch = fetch, now = Date.now(), verify = verifyQuoteSignature, maxAppFeeBps = 20) {
  return collectSetupDelivery(input, jwt, fetcher, now, verify, maxAppFeeBps, "payment");
}
