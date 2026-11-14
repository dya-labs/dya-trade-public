import type { QuoteTimings } from "./quote-timings";
import { isNoLiquidityRejection, quoteRejection } from "../providers/quote-rejection";
import { requestedAppFees, verifyQuoteFees } from "./fee-verification";
import { verifyQuoteSignature, type OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import type { FeePlan } from "../../../../../packages/wallet-contracts/src/domain/trading-fees";
import { DEFAULT_SLIPPAGE_BPS, selectMarketSlippage } from "./slippage";
import { providerFetch, ONE_CLICK_BASE, oneClickHeaders } from "../providers/http";
import { DEFAULT_PAIR, quantityRaw, type SelectedPair } from "../../../../../packages/wallet-contracts/src/domain/catalog";
import { balanceFor } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { AppError, ErrorCode, type StaticErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";
import { type LiveBalances } from "../../../../../packages/wallet-contracts/src/domain/assets";

/** Review collecting its own quote when it holds no stored one. */
export const MARKET_QUOTE_WAIT_MS = 1000;
/**
 * The ticket's two quotes for a new input, requested together: the quick one is shown first, the
 * full one replaces it. A 200 ms quick window answered every time for hours, then not at all.
 */
export const QUICK_MARKET_QUOTE_WAIT_MS = 300;
export const BACKGROUND_MARKET_QUOTE_WAIT_MS = 1500;

const ENDPOINT = `${ONE_CLICK_BASE}/v0/quote`;
type Side = "buy" | "sell";

function record(value: unknown, message: StaticErrorCode = ErrorCode.InvalidOneClickQuoteResponse) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(message);
  return value as Record<string, unknown>;
}
function text(value: unknown) {
  if (typeof value !== "string" || value.length < 1 || value.length > 1024) throw new AppError(ErrorCode.InvalidOneClickQuoteResponse);
  return value;
}
function rawAmount(value: unknown) {
  const result = text(value);
  if (!/^(0|[1-9][0-9]{0,77})$/.test(result)) throw new AppError(ErrorCode.InvalidOneClickQuoteAmount);
  return result;
}
function displayAmount(value: unknown) {
  const result = text(value);
  if (!/^(0|[1-9][0-9]{0,77})(\.[0-9]{1,38})?$/.test(result)) throw new AppError(ErrorCode.InvalidOneClickFormattedAmount);
  return result;
}

// quoteAmount is an exact spending amount, only valid for market buys.
export function marketSize(body: Record<string, unknown>, pair: SelectedPair) {
  if (body.quoteAmount !== undefined && body.side !== "buy") throw new AppError(ErrorCode.ChooseBuyOrSell);
  const exactInput = body.side === "sell" || body.quoteAmount !== undefined;
  const amount = quantityRaw(body.quoteAmount !== undefined ? body.quoteAmount : body.quantity, body.quoteAmount !== undefined ? pair.quote.decimals : pair.base.decimals);
  return { exactInput, amount };
}

export function marketQuoteRequest(body: Record<string, unknown>, accountId: string, now = Date.now(), pair: SelectedPair = DEFAULT_PAIR) {
  if (body.pairId !== undefined && body.pairId !== pair.id) throw new AppError(ErrorCode.UnsupportedMarketCapability);
  const side = body.side as Side;
  if (side !== "buy" && side !== "sell") throw new AppError(ErrorCode.ChooseBuyOrSell);
  const size = marketSize(body, pair);
  if (!/^0x[0-9a-f]{40}$/.test(accountId)) throw new AppError(ErrorCode.InvalidIntentsAccount);
  return {
    confidentiality: "advanced",
    dry: true,
    swapType: size.exactInput ? "EXACT_INPUT" : "EXACT_OUTPUT",
    slippageTolerance: DEFAULT_SLIPPAGE_BPS,
    originAsset: (side === "buy" ? pair.quote : pair.base).assetId,
    depositType: "CONFIDENTIAL_INTENTS",
    destinationAsset: (side === "buy" ? pair.base : pair.quote).assetId,
    amount: size.amount,
    refundTo: accountId,
    refundType: "CONFIDENTIAL_INTENTS",
    recipient: accountId,
    recipientType: "CONFIDENTIAL_INTENTS",
    deadline: new Date(now + 15 * 60_000).toISOString(),
    // Limit quote collection latency; returned quotes still require full validation.
    quoteWaitingTimeMs: MARKET_QUOTE_WAIT_MS,
  } as const;
}

export async function previewMarket(
  body: Record<string, unknown>,
  balances: LiveBalances,
  jwt: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  pair: SelectedPair = DEFAULT_PAIR,
  feePlan?: FeePlan,
  verifySignature = verifyQuoteSignature,
  timings?: QuoteTimings,
) {
  const baseRequest = marketQuoteRequest(body, balances.accountId, now, pair);
  const slippage = selectMarketSlippage(body.slippage);
  const request = { ...baseRequest, slippageTolerance: slippage.bps, ...(feePlan ? { appFees: requestedAppFees(feePlan, "market") } : {}) };
  if (!jwt.trim()) throw new AppError(ErrorCode.OneClickMarketQuotesAreNotConfiguredAddONECLICKJWTToEnableThem);
  let response: Response;
  try {
    const fetchQuote = () => providerFetch(fetcher, ENDPOINT, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000),
      headers: oneClickHeaders(jwt),
      body: JSON.stringify(request),
    });
    response = await (timings ? timings.measure("oneclick", fetchQuote) : fetchQuote());
  } catch {
    throw new AppError(ErrorCode.OneClickMarketQuoteServiceIsUnavailable);
  }
  let payload: unknown;
  try { payload = await response.json(); }
  catch {
    if (!response.ok) console.warn("trading.quote.preview_rejected", { status: response.status, reason: "Non-JSON provider response" });
    throw new AppError(ErrorCode.OneClickReturnedAnInvalidMarketQuote);
  }
  if (!response.ok) {
    console.warn("trading.quote.preview_rejected", { status: response.status, ...quoteRejection(payload, [jwt, balances.accountId]) });
    if (response.status === 400 && isNoLiquidityRejection(payload)) throw new AppError(ErrorCode.MarketLiquidityUnavailable);
    throw new AppError(response.status === 401 || response.status === 403 ? ErrorCode.OneClickMarketQuoteCredentialsWereRejected : ErrorCode.OneClickMarketQuoteUnavailable);
  }
  const root = record(payload), echoed = record(root.quoteRequest), quote = record(root.quote);
  for (const key of ["slippageTolerance", "confidentiality", "swapType", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType"] as const)
    if (echoed[key] !== request[key]) throw new AppError(ErrorCode.OneClickQuoteDoesNotMatchTheRequestedMarketTrade);
  if (echoed.dry !== true || quote.depositAddress !== undefined || quote.depositMemo !== undefined)
    throw new AppError(ErrorCode.OneClickReturnedAnExecutableQuoteDuringPreview);
  if (feePlan && !verifySignature(root as unknown as OneClickQuoteResponse)) throw new AppError(ErrorCode.OneClickExecutableQuoteSignatureIsInvalid);
  const feeReceipt = feePlan ? verifyQuoteFees(root, feePlan) : undefined;
  const amountIn = rawAmount(quote.amountIn), amountOut = rawAmount(quote.amountOut);
  const amountInFormatted = displayAmount(quote.amountInFormatted), amountOutFormatted = displayAmount(quote.amountOutFormatted);
  const minAmountOut = rawAmount(quote.minAmountOut);
  const inputAsset = body.side === "buy" ? pair.quote : pair.base;
  const outputAsset = body.side === "buy" ? pair.base : pair.quote;
  const input = balanceFor(balances, request.originAsset, inputAsset);
  if (new D(amountInFormatted).mul(new D(10).pow(inputAsset.decimals)).toFixed() !== amountIn ||
      new D(amountOutFormatted).mul(new D(10).pow(outputAsset.decimals)).toFixed() !== amountOut ||
      new D(minAmountOut).gt(amountOut) ||
      (request.swapType === "EXACT_OUTPUT" ? amountOut : amountIn) !== request.amount)
    throw new AppError(ErrorCode.OneClickQuoteDoesNotMatchTheRequestedMarketTrade);
  if (BigInt(amountIn) === BigInt(0) || BigInt(amountOut) === BigInt(0)) throw new AppError(ErrorCode.OneClickReturnedAnEmptyMarketQuote);
  return {
    ...(feeReceipt ? { feeReceipt } : {}),
    pair,
    orderType: "market" as const,
    submissionEnabled: false as const,
    side: body.side as Side,
    quantity: body.side === "buy" ? amountOutFormatted : amountInFormatted,
    inputSymbol: input.symbol,
    outputSymbol: request.destinationAsset === pair.base.assetId ? pair.base.symbol : pair.quote.symbol,
    principal: amountInFormatted,
    estimatedOutput: amountOutFormatted,
    minimumOutput: new D(minAmountOut).div(new D(10).pow(outputAsset.decimals)).toFixed(),
    available: input.amount,
    shortfall: D.max(0, new D(amountIn).minus(input.raw)).div(new D(10).pow(input.decimals)).toFixed(),
    balanceBlock: balances.blockHeight,
    slippageBps: request.slippageTolerance,
    slippagePolicy: slippage.policy,
    timeEstimateSeconds: typeof quote.timeEstimate === "number" && Number.isFinite(quote.timeEstimate) && quote.timeEstimate >= 0 ? quote.timeEstimate : null,
    expiresAt: request.deadline,
  };
}

export type MarketPreview = Awaited<ReturnType<typeof previewMarket>>;
