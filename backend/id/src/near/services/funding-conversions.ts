import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_PAIR, makePair, quantityRaw, type CatalogAsset } from "../../../../../packages/wallet-contracts/src/domain/catalog";
import { fundingAssets } from "../../../../../packages/wallet-contracts/src/domain/funding-balances";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import type { LiveBalances } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { prepareExecutableMarketTrade, validateExecutableMarketTrade, type ExecutableMarketTrade } from "./market-execution";
import { fundingBatch, type FundingBatch } from "../../../../../packages/wallet-contracts/src/http/schemas/funding-conversions";
export type StoredFundingBatch = Omit<FundingBatch, "legs"> & { legs: (Omit<FundingBatch["legs"][number], "review"> & { review: ExecutableMarketTrade })[] };
export const isUnresolvedFundingLeg = (leg: { state: string }) => ["submitting", "submitted", "unknown"].includes(leg.state);
export function fundingBatchState(legs: { state: string }[]): FundingBatch["state"] {
  if (legs.some(l => l.state === "unknown")) return "unknown";
  if (legs.some(isUnresolvedFundingLeg)) return "processing";
  if (legs.every(l => l.state === "settled")) return "settled";
  if (legs.some(l => l.state === "settled")) return "partial";
  if (legs.some(l => l.state === "ready")) return "ready";
  return legs.some(l => l.state === "failed") ? "failed" : "cancelled";
}
export function publicFundingBatch(batch: StoredFundingBatch): FundingBatch {
  // Zod strips the server-only payload/challenge before any response.
  return fundingBatch.parse({ ...batch, state: fundingBatchState(batch.legs) });
}
export function validateFundingLeg(leg: StoredFundingBatch["legs"][number], accountId: string, now = Date.now()) {
  const r = leg.review;
  if (r.confidentiality !== "advanced" || r.side !== "sell" || r.pair?.quote.assetId !== DEFAULT_PAIR.quote.assetId ||
      r.pair.quote.decimals !== DEFAULT_PAIR.quote.decimals || r.pair.quote.blockchain !== "near" ||
      r.pair.base.assetId !== leg.asset.assetId || r.pair.base.decimals !== leg.asset.decimals ||
      quantityRaw(leg.amount, leg.asset.decimals) !== r.inputRaw)
    throw new Error("Funding conversion does not match the reviewed route.");
  validateExecutableMarketTrade(r, accountId, now);
}
export async function prepareFundingBatch(body: unknown, accountId: string, catalog: CatalogAsset[], balances: LiveBalances,
  prepare = prepareExecutableMarketTrade): Promise<StoredFundingBatch> {
  const { inputs } = z.object({ inputs: z.array(z.object({ assetId: z.string(), amount: z.string() }).strict()).min(1).max(64) }).strict().parse(body);
  if (balances.accountId !== accountId || new Set(inputs.map(i => i.assetId)).size !== inputs.length) throw new AppError(ErrorCode.InvalidFundingSelection);
  const eligible = fundingAssets(catalog);
  const target = catalog.find(a => a.assetId === DEFAULT_PAIR.quote.assetId && a.blockchain === "near" && a.decimals === DEFAULT_PAIR.quote.decimals);
  if (!target) throw new AppError(ErrorCode.TradingUSDCOnNEARUnavailable);
  const selected = inputs.map(i => {
    const asset = eligible.find(a => a.assetId === i.assetId);
    if (!asset) throw new AppError(ErrorCode.ChooseASupportedStablecoinFundingBalance);
    const raw = quantityRaw(i.amount, asset.decimals);
    const b = balances.assets.find(b => b.assetId === asset.assetId && b.decimals === asset.decimals);
    if (!b || BigInt(raw) > BigInt(b.raw)) throw new AppError(ErrorCode.InsufficientFundingBalance);
    return { asset, amount: new D(i.amount).toFixed() };
  });
  const rows: ({ leg: StoredFundingBatch["legs"][number] } | { excluded: FundingBatch["excluded"][number] })[] = [];
  let next = 0;
  async function worker() {
    while (next < selected.length) {
      const index = next++, i = selected[index];
      try {
        const review = await prepare({ side: "sell", quantity: i.amount }, balances, process.env.ONE_CLICK_JWT ?? "", undefined, undefined, undefined, makePair(i.asset, target!), true);
        const leg = { id: randomUUID(), ...i, state: "ready" as const, review };
        validateFundingLeg(leg, accountId);
        rows[index] = { leg };
      } catch (error) {
        // Only route unavailability can be excluded. Invalid signatures, altered
        // amounts, expired payloads and auth failures invalidate the whole review.
        if (!(error instanceof AppError) || (error.code !== ErrorCode.ExecutableMarketQuoteUnavailable && error.code !== ErrorCode.MarketLiquidityUnavailable)) throw error;
        rows[index] = { excluded: { ...i, reason: "No conversion quote available. This balance stays in Funding." } };
      }
    }
  }
  const outcomes = await Promise.allSettled([worker(), worker(), worker()]);
  const rejected = outcomes.find(o => o.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  const legs = rows.flatMap(r => "leg" in r ? [r.leg] : []), excluded = rows.flatMap(r => "excluded" in r ? [r.excluded] : []);
  if (!legs.length) throw new AppError(ErrorCode.NoConfidentialRouteToUSDCOnNEARAvailable);
  legs.forEach(l => validateFundingLeg(l, accountId));
  const outputAmount = legs.reduce((s, l) => s.add(l.review.estimatedOutput), new D(0)).toFixed();
  const minimumOutput = legs.reduce((s, l) => s.add(l.review.minimumOutput), new D(0)).toFixed();
  const inputUsd = legs.every(l => l.asset.price !== undefined && new D(l.asset.price).gt(0))
    ? legs.reduce((s, l) => s.add(new D(l.amount).mul(l.asset.price!)), new D(0)).toFixed() : null;
  return { id: randomUUID(), createdAt: Date.now(), updatedAt: Date.now(), state: "ready", legs, excluded,
    expiresAt: new Date(Math.min(...legs.map(l => Date.parse(l.review.expiresAt)))).toISOString(), outputAmount, minimumOutput,
    inputUsd, costUsd: inputUsd === null ? null : new D(inputUsd).minus(outputAmount).toFixed() };
}
