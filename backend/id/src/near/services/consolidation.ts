import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { base58 } from "@scure/base";
import { DEFAULT_PAIR, type CatalogAsset } from "../../../../../packages/wallet-contracts/src/domain/catalog";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";
import { fundingAssets } from "../../../../../packages/wallet-contracts/src/domain/funding-balances";
import type { LiveBalances } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { providerFetch } from "../providers/http";
import { publicRpc, VERIFIER, payloadChallenge, versionedNonce } from "../auth/intents";
import type { PreparedConsolidation } from "../../../../../packages/wallet-contracts/src/http/schemas/consolidation";
const positiveRaw = z.string().regex(/^[1-9][0-9]{0,38}$/).refine(v => BigInt(v) <= (BigInt(1) << BigInt(127)) - BigInt(1));
const quoteSchema = z.object({ defuse_asset_identifier_in: z.string(), defuse_asset_identifier_out: z.string(), amount_in: positiveRaw, amount_out: positiveRaw, expiration_time: z.string().datetime({ offset: true }), quote_hash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/) });
export async function relayRpc(method: string, params: Record<string, unknown>, fetcher: typeof fetch = fetch) {
  const key = process.env.ONE_CLICK_JWT;
  if (!key) throw new Error("Funding conversion is not configured.");
  const res = await providerFetch(fetcher, "https://solver-relay-v2.chaindefuser.com/rpc", { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": key }, body: JSON.stringify({ jsonrpc: "2.0", id: "funding", method, params: [params] }) });
  const data = await res.json();
  if (!res.ok || data.error || data.result === undefined) throw new AppError(ErrorCode.FundingRelayUnavailable);
  return data.result as unknown;
}
export async function prepareConsolidation(body: unknown, accountId: string, catalog: CatalogAsset[], balances: LiveBalances, fetcher: typeof fetch = fetch, now = Date.now()) : Promise<PreparedConsolidation> {
  const { inputs, skipUnavailable } = z.object({ skipUnavailable: z.boolean().optional(), inputs: z.array(z.object({ assetId: z.string(), amount: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/) }).strict()).min(1).max(8) }).strict().parse(body);
  if (balances.accountId !== accountId || new Set(inputs.map(i => i.assetId)).size !== inputs.length) throw new AppError(ErrorCode.InvalidFundingSelection);
  const eligible = fundingAssets(catalog);
  let selected = inputs.map(input => {
    const asset = eligible.find(a => a.assetId === input.assetId);
    if (!asset || (input.amount.split(".")[1]?.length ?? 0) > asset.decimals) throw new AppError(ErrorCode.ChooseASupportedUSDCBalanceAndAmount);
    const raw = positiveRaw.parse(new D(input.amount).mul(new D(10).pow(asset.decimals)).toFixed());
    const balance = balances.assets.find(a => a.assetId === asset.assetId && a.decimals === asset.decimals);
    if (!balance || BigInt(raw) > BigInt(balance.raw)) throw new AppError(ErrorCode.InsufficientFundingBalance);
    return { asset, raw, amount: new D(input.amount).toFixed() };
  });
  const results = await Promise.all(selected.map(async input => {
    const response = await relayRpc("quote", { defuse_asset_identifier_in: input.asset.assetId, defuse_asset_identifier_out: DEFAULT_PAIR.quote.assetId, exact_amount_in: input.raw, min_deadline_ms: 60000 }, fetcher);
    if (skipUnavailable && (response == null || (Array.isArray(response) && response.length === 0))) return null;
    const candidates = z.array(z.unknown()).parse(response ?? []).flatMap(row => { const q = quoteSchema.safeParse(row); return q.success ? [q.data] : []; }).filter(q => q.defuse_asset_identifier_in === input.asset.assetId && q.defuse_asset_identifier_out === DEFAULT_PAIR.quote.assetId && q.amount_in === input.raw && Date.parse(q.expiration_time) > now + 30000);
    candidates.sort((a, b) => BigInt(a.amount_out) > BigInt(b.amount_out) ? -1 : 1);
    if (!candidates[0]) throw new AppError(ErrorCode.NoValidQuoteForChainUSDC, input.asset.blockchain);
    return candidates[0];
  }));
  const excluded = selected.filter((_, n) => results[n] === null).map(i => ({ asset: i.asset, amount: i.amount, reason: "No quote available for this amount. Left in Funding." }));
  selected = selected.filter((_, n) => results[n] !== null);
  const quotes = results.filter(q => q !== null);
  if (!quotes.length) throw new AppError(ErrorCode.NoNetworkCouldProvideAQuote);
  const res = await publicRpc(JSON.stringify({ jsonrpc: "2.0", id: "funding-salt", method: "query", params: { request_type: "call_function", finality: "final", account_id: VERIFIER, method_name: "current_salt", args_base64: "e30=" } }), fetcher);
  const rpc = await res.json();
  if (!res.ok || rpc.error || rpc.result?.error || !Array.isArray(rpc.result?.result)) throw new Error("Unable to prepare signing nonce.");
  const salt = z.string().regex(/^[a-f0-9]{8}$/).parse(JSON.parse(Buffer.from(rpc.result.result).toString()));
  const expires = Math.min(now + 120000, ...quotes.map(q => Date.parse(q.expiration_time))) - 5000;
  if (expires < Date.now() + 15000) throw new AppError(ErrorCode.QuotesExpired);
  const outputRaw = positiveRaw.parse(quotes.reduce((sum, q) => sum + BigInt(q.amount_out), BigInt(0)).toString());
  const diff: Record<string, string> = Object.fromEntries(selected.map(i => [i.asset.assetId, `-${i.raw}`]));
  diff[DEFAULT_PAIR.quote.assetId] = outputRaw;
  const payload = JSON.stringify({ signer_id: accountId, verifying_contract: VERIFIER, deadline: new Date(expires).toISOString(), nonce: versionedNonce(salt, expires), intents: [{ intent: "token_diff", diff }] });
  const outputAmount = new D(outputRaw).div(new D(10).pow(DEFAULT_PAIR.quote.decimals)).toFixed();
  const inputAmount = selected.reduce((sum, i) => sum.plus(i.amount), new D(0)).toFixed();
  return { payload, quoteHashes: quotes.map(q => q.quote_hash), review: { excluded, id: randomUUID(), accountId, expiresAt: new Date(expires).toISOString(), inputs: selected.map((i, n) => ({ ...i, outputRaw: quotes[n].amount_out })), outputRaw, outputAmount, inputAmount, costAmount: new D(inputAmount).minus(outputAmount).toFixed() } };
}
export function validateConsolidation(prepared: PreparedConsolidation, accountId: string, now = Date.now()) {
  const { review, payload, quoteHashes } = prepared;
  const p = JSON.parse(payload);
  const diff = Object.fromEntries(review.inputs.map(i => [i.asset.assetId, `-${positiveRaw.parse(i.raw)}`]));
  diff[DEFAULT_PAIR.quote.assetId] = positiveRaw.parse(review.outputRaw);
  if (review.accountId !== accountId || p.signer_id !== accountId || p.verifying_contract !== VERIFIER || p.deadline !== review.expiresAt || Date.parse(review.expiresAt) <= now || !Number.isFinite(Date.parse(review.expiresAt)) || review.inputs.length < 1 || quoteHashes.length !== review.inputs.length || new Set(review.inputs.map(i => i.asset.assetId)).size !== review.inputs.length || review.inputs.some(i => i.asset.assetId === DEFAULT_PAIR.quote.assetId) || JSON.stringify(p.intents) !== JSON.stringify([{ intent: "token_diff", diff }])) throw new AppError(ErrorCode.FundingReviewIsInvalidOrExpired);
  if (review.inputs.some(i => new D(i.amount).mul(new D(10).pow(i.asset.decimals)).toFixed() !== i.raw) ||
      review.inputs.reduce((sum, i) => sum + BigInt(positiveRaw.parse(i.outputRaw)), BigInt(0)).toString() !== review.outputRaw ||
      new D(review.outputRaw).div(new D(10).pow(DEFAULT_PAIR.quote.decimals)).toFixed() !== review.outputAmount ||
      review.inputs.reduce((sum, i) => sum.plus(i.amount), new D(0)).toFixed() !== review.inputAmount ||
      new D(review.inputAmount).minus(review.outputAmount).toFixed() !== review.costAmount)
    throw new Error("Funding review amounts mismatch.");
  return base58.encode(payloadChallenge(payload));
}
