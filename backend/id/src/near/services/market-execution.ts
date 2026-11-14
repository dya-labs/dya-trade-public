import type { QuoteTimings } from "./quote-timings";
import { MARKET_QUOTE_WAIT_MS, marketSize } from "./one-click-market";
import { requestedAppFees, verifyQuoteFees, validateFeeReceipt } from "./fee-verification";
import type { FeePlan, FeeReceipt } from "../../../../../packages/wallet-contracts/src/domain/trading-fees";
import { DEFAULT_SLIPPAGE_BPS, selectMarketSlippage, type SlippagePolicy } from "./slippage";
import { PRIVATE_VERIFIER, validatePrivateTransfer } from "../../../../../packages/wallet-contracts/src/domain/confidential";
import { providerFetch, ONE_CLICK_BASE, oneClickHeaders } from "../providers/http";
import { isNoLiquidityRejection, quoteRejection } from "../providers/quote-rejection";
import { DEFAULT_PAIR, makePair, selectedPairSchema, quantityRaw as parseQuantity, type SelectedPair } from "../../../../../packages/wallet-contracts/src/domain/catalog";
import { balanceFor } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { AppError, ErrorCode, type StaticErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { verifyQuoteSignature, type OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";
import { type LiveBalances } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { payloadChallenge, VERIFIER, type SignedWebAuthn } from "../auth/intents";

const QUOTE_ENDPOINT = `${ONE_CLICK_BASE}/v0/quote`;
const GENERATE_INTENT_ENDPOINT = `${ONE_CLICK_BASE}/v0/generate-intent`;
const SUBMIT_INTENT_ENDPOINT = `${ONE_CLICK_BASE}/v0/submit-intent`;

function object(value: unknown, message: StaticErrorCode = ErrorCode.InvalidOneClickResponse) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(message);
  return value as Record<string, unknown>;
}
function text(value: unknown, message: StaticErrorCode = ErrorCode.InvalidOneClickResponse) {
  if (typeof value !== "string" || !value.length || value.length > 8192) throw new AppError(message);
  return value;
}
function rawAmount(value: unknown) {
  const result = text(value);
  if (!/^[1-9][0-9]{0,77}$/.test(result)) throw new AppError(ErrorCode.InvalidOneClickAmount);
  return result;
}
function displayAmount(value: unknown) {
  const result = text(value);
  if (!/^(0|[1-9][0-9]{0,77})(\.[0-9]{1,38})?$/.test(result)) throw new AppError(ErrorCode.InvalidOneClickFormattedAmount);
  return result;
}

export type ExecutableMarketTrade = {
  feeReceipt?: FeeReceipt;
  confidentiality?: "advanced";
  orderType: "market";
  side: "buy" | "sell";
  submissionEnabled: true;
  quantity: string;
  pair?: SelectedPair;
  inputSymbol: string;
  outputSymbol: string;
  inputRaw: string;
  outputRaw: string;
  principal: string;
  estimatedOutput: string;
  minimumOutput: string;
  available: string;
  shortfall: string;
  balanceBlock: number;
  slippageBps: number;
  slippagePolicy?: SlippagePolicy;
  expiresAt: string;
  depositAddress: string;
  depositMemo: null;
  correlationId: string;
  payload: string;
  challenge: string;
};

function authHeaders(jwt: string) {
  return oneClickHeaders(jwt, "api-key");
}

type MarketBalanceSource = LiveBalances | { accountId: string; load: () => Promise<LiveBalances> };

export type ExecutableMarketQuote = Omit<ExecutableMarketTrade, "payload" | "challenge" | "correlationId"> & { accountId: string; quoteExpiresAt: string; swapType: "EXACT_INPUT" | "EXACT_OUTPUT" };

export async function prepareExecutableMarketTrade(
  body: Record<string, unknown>,
  balanceSource: MarketBalanceSource,
  jwt: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  verifySignature: (response: OneClickQuoteResponse) => boolean = verifyQuoteSignature,
  pair: SelectedPair = DEFAULT_PAIR,
  confidential = false,
  feePlan?: FeePlan,
  timings?: QuoteTimings,
): Promise<ExecutableMarketTrade> {
  const quote = await collectExecutableMarketQuote(body, balanceSource, jwt, fetcher, now, verifySignature, pair, confidential, feePlan, timings);
  return prepareMarketSigningPayload(quote, balanceSource.accountId, jwt, fetcher, now, timings);
}

export async function collectExecutableMarketQuote(
  body: Record<string, unknown>,
  balanceSource: MarketBalanceSource,
  jwt: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  verifySignature: (response: OneClickQuoteResponse) => boolean = verifyQuoteSignature,
  pair: SelectedPair = DEFAULT_PAIR,
  confidential = false,
  feePlan?: FeePlan,
  timings?: QuoteTimings,
  options: { allowShortfall?: boolean; quoteWaitingTimeMs?: number } = {},
): Promise<ExecutableMarketQuote> {
  const { allowShortfall = false, quoteWaitingTimeMs = MARKET_QUOTE_WAIT_MS } = options;
  if (body.pairId !== undefined && body.pairId !== pair.id) throw new AppError(ErrorCode.UnsupportedMarketCapability);
  if (body.side !== "buy" && body.side !== "sell") throw new AppError(ErrorCode.ChooseBuyOrSell);
  const side = body.side;
  const size = marketSize(body, pair);
  const quantityRaw = size.amount;
  if (!jwt.trim()) throw new AppError(ErrorCode.OneClickExecutionIsNotConfigured);
  const accountId = balanceSource.accountId;
  const buy = side === "buy";
  const inputAsset = (buy ? pair.quote : pair.base);
  const outputAsset = (buy ? pair.base : pair.quote);
  if (!allowShortfall && !("load" in balanceSource) && !buy && new D(quantityRaw).gt(balanceFor(balanceSource, pair.base.assetId, pair.base).raw)) throw new AppError(ErrorCode.InsufficientExecutableBalance, pair.base.symbol);
  const timedFetch = (stage: "executable" | "signing_payload", endpoint: string, init: RequestInit) =>
    timings ? timings.measure(stage, () => providerFetch(fetcher, endpoint, init)) : providerFetch(fetcher, endpoint, init);
  const baseRequest = {
    ...(feePlan ? { appFees: requestedAppFees(feePlan, "market") } : {}),
    ...(confidential ? { confidentiality: "advanced" } : {}),
    dry: false,
    swapType: size.exactInput ? "EXACT_INPUT" : "EXACT_OUTPUT",
    slippageTolerance: DEFAULT_SLIPPAGE_BPS,
    originAsset: inputAsset.assetId,
    depositType: confidential ? "CONFIDENTIAL_INTENTS" : "INTENTS",
    destinationAsset: outputAsset.assetId,
    amount: quantityRaw,
    refundTo: accountId,
    refundType: confidential ? "CONFIDENTIAL_INTENTS" : "INTENTS",
    recipient: accountId,
    recipientType: confidential ? "CONFIDENTIAL_INTENTS" : "INTENTS",
    deadline: new Date(now + 15 * 60_000).toISOString(),
    quoteWaitingTimeMs,
  } as const;
  const slippage = selectMarketSlippage(body.slippage);
  const request = { ...baseRequest, slippageTolerance: slippage.bps };
  // Observe failures immediately, even if quote validation rejects before this read is awaited.
  // Both independent reads start together; no signing payload is requested until both pass.
  const balanceResult = Promise.resolve().then(() => "load" in balanceSource ? balanceSource.load() : balanceSource)
    .then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
  const response = await timedFetch("executable", QUOTE_ENDPOINT, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: authHeaders(jwt), body: JSON.stringify(request),
  });
  if (!response.ok) {
    let payload: unknown;
    try { payload = await response.json(); } catch { /* Logged as a missing reason. */ }
    console.warn("trading.quote.executable_rejected", { status: response.status, ...quoteRejection(payload, [jwt, accountId]) });
    if (response.status === 400 && isNoLiquidityRejection(payload)) throw new AppError(ErrorCode.MarketLiquidityUnavailable);
    throw new AppError(response.status === 401 || response.status === 403 ? ErrorCode.OneClickExecutionCredentialsWereRejected : ErrorCode.ExecutableMarketQuoteUnavailable);
  }
  let data: unknown;
  try { data = await response.json(); } catch { throw new AppError(ErrorCode.OneClickReturnedAnInvalidExecutableQuote); }
  const root = object(data), echoed = object(root.quoteRequest), quote = object(root.quote);
  if (!verifySignature(root as unknown as OneClickQuoteResponse)) throw new AppError(ErrorCode.OneClickExecutableQuoteSignatureIsInvalid);
  for (const key of ["slippageTolerance", "swapType", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType"] as const)
    if (echoed[key] !== request[key]) throw new AppError(ErrorCode.ExecutableQuoteDoesNotMatchTheRequestedMarketTrade);
  if (typeof echoed.deadline !== "string" || Date.parse(echoed.deadline) !== Date.parse(request.deadline))
    throw new AppError(ErrorCode.ExecutableQuoteDoesNotMatchTheRequestedMarketTrade);
  if (confidential && echoed.confidentiality !== "advanced") throw new AppError(ErrorCode.ConfidentialQuoteRequired);
  if (echoed.dry !== false) throw new AppError(ErrorCode.OneClickReturnedADryQuoteForExecution);
  const feeReceipt = feePlan ? verifyQuoteFees(root, feePlan) : undefined;
  const depositAddress = text(quote.depositAddress);
  if (depositAddress.length > 256 || /[\s\u0000-\u001f\u007f]/.test(depositAddress))
    throw new AppError(ErrorCode.OneClickReturnedAnInvalidIntentsDepositAccount);
  if (quote.depositMemo !== undefined && quote.depositMemo !== null) throw new AppError(ErrorCode.MemoBasedIntentsFundingIsNotSupported);
  const amountIn = rawAmount(quote.amountIn), amountOut = rawAmount(quote.amountOut), minAmountOut = rawAmount(quote.minAmountOut);
  const amountInFormatted = displayAmount(quote.amountInFormatted), amountOutFormatted = displayAmount(quote.amountOutFormatted);
  if (new D(amountInFormatted).mul(new D(10).pow(inputAsset.decimals)).toFixed() !== amountIn ||
      new D(amountOutFormatted).mul(new D(10).pow(outputAsset.decimals)).toFixed() !== amountOut)
    throw new AppError(ErrorCode.OneClickFormattedAmountsDoNotMatchTheExecutableQuote);
  if (new D(minAmountOut).gt(amountOut) || (size.exactInput ? amountIn !== quantityRaw : amountOut !== quantityRaw))
    throw new AppError(ErrorCode.OneClickExecutableQuoteChangedTheRequestedMarketSize);
  const quoteExpiry = Date.parse(text(quote.deadline, ErrorCode.OneClickExecutableQuoteHasNoExpiry));
  if (!Number.isFinite(quoteExpiry) || quoteExpiry <= now + 15_000) throw new AppError(ErrorCode.ExecutableQuoteExpiresTooSoon);
  const result = await balanceResult;
  if (!result.ok) throw result.error;
  const balances = result.value;
  if (balances.accountId !== accountId) throw new AppError(ErrorCode.SessionChanged);
  const input = balanceFor(balances, inputAsset.assetId, inputAsset);
  if (!allowShortfall && new D(amountIn).gt(input.raw)) throw new AppError(ErrorCode.InsufficientExecutableBalance, inputAsset.symbol);

  return {
    ...(feeReceipt ? { feeReceipt } : {}),
    ...(confidential ? { confidentiality: "advanced" as const } : {}),
    orderType: "market", side, submissionEnabled: true, quantity: buy ? amountOutFormatted : amountInFormatted, pair,
    inputSymbol: inputAsset.symbol, outputSymbol: outputAsset.symbol, inputRaw: amountIn, outputRaw: amountOut,
    principal: amountInFormatted, estimatedOutput: amountOutFormatted,
    minimumOutput: new D(minAmountOut).div(new D(10).pow(outputAsset.decimals)).toFixed(),
    available: input.amount, shortfall: D.max(0, new D(amountIn).minus(input.raw)).div(new D(10).pow(inputAsset.decimals)).toFixed(), balanceBlock: balances.blockHeight,
    slippageBps: request.slippageTolerance, slippagePolicy: slippage.policy,
    expiresAt: new Date(Math.min(quoteExpiry, Date.parse(request.deadline))).toISOString(),
    accountId, quoteExpiresAt: new Date(quoteExpiry).toISOString(), swapType: request.swapType, depositAddress, depositMemo: null,
  };
}

export async function prepareMarketSigningPayload(quote: ExecutableMarketQuote, accountId: string, jwt: string, fetcher: typeof fetch = fetch, now = Date.now(), timings?: QuoteTimings): Promise<ExecutableMarketTrade> {
  if (!jwt.trim()) throw new AppError(ErrorCode.OneClickExecutionIsNotConfigured);
  if (quote.accountId !== accountId) throw new AppError(ErrorCode.SessionChanged);
  if (quote.shortfall !== "0") throw new AppError(ErrorCode.InsufficientExecutableBalance, quote.inputSymbol);
  if (Date.parse(quote.expiresAt) <= now + 15_000) throw new AppError(ErrorCode.ExecutableQuoteExpiresTooSoon);
  const fetchSigningPayload = (init: RequestInit) => timings
    ? timings.measure("signing_payload", () => providerFetch(fetcher, GENERATE_INTENT_ENDPOINT, init))
    : providerFetch(fetcher, GENERATE_INTENT_ENDPOINT, init);
  const generatedResponse = await fetchSigningPayload({
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: authHeaders(jwt),
    body: JSON.stringify({ type: "swap_transfer", standard: "webauthn", signerId: accountId, depositAddress: quote.depositAddress }),
  });
  let generatedData: unknown;
  try { generatedData = await generatedResponse.json(); } catch { throw new AppError(ErrorCode.OneClickReturnedAnInvalidSigningPayload); }
  if (!generatedResponse.ok)
    throw new AppError(generatedResponse.status === 401 || generatedResponse.status === 403 ? ErrorCode.OneClickExecutionCredentialsWereRejected : ErrorCode.OneClickCouldNotPrepareTheSignedSwap);
  const generated = object(generatedData, ErrorCode.InvalidOneClickSigningResponse);
  const intent = object(generated.intent, ErrorCode.OneClickReturnedNoSigningIntent);
  if (intent.standard !== "webauthn") throw new AppError(ErrorCode.OneClickReturnedAnUnsupportedSigningStandard);
  const payload = text(intent.payload, ErrorCode.OneClickReturnedAnInvalidWebAuthnPayload);
  let payloadRoot: Record<string, unknown>;
  try { payloadRoot = object(JSON.parse(payload)); } catch { throw new AppError(ErrorCode.OneClickReturnedAMalformedWebAuthnPayload); }
  const intentExpiry = Date.parse(String(payloadRoot.deadline));
  if (!Number.isFinite(intentExpiry) || intentExpiry <= now + 15_000 || intentExpiry > Date.parse(quote.quoteExpiresAt))
    throw new AppError(ErrorCode.OneClickSigningPayloadHasAnInvalidExpiry);
  const { accountId: _accountId, quoteExpiresAt: _quoteExpiresAt, swapType: _swapType, ...fields } = quote;
  void _accountId; void _quoteExpiresAt; void _swapType;
  const review: ExecutableMarketTrade = { ...fields, correlationId: text(generated.correlationId), payload,
    challenge: payloadChallenge(payload).toString("base64url"),
    expiresAt: new Date(Math.min(intentExpiry, Date.parse(quote.expiresAt))).toISOString() };
  validateExecutableMarketTrade(review, accountId, now);
  return review;
}

export function validateExecutableMarketTrade(review: ExecutableMarketTrade, accountId: string, now = Date.now()) {
  if (review.feeReceipt) {
    if (review.feeReceipt.plan.kind !== "market") throw new AppError(ErrorCode.TradingFeeVerificationFailed);
    validateFeeReceipt(review.feeReceipt);
  }
  if (!review.submissionEnabled || !["buy", "sell"].includes(review.side) || review.shortfall !== "0" || review.depositMemo !== null)
    throw new AppError(ErrorCode.MarketTradeIsNotExecutable);
  const pair = selectedPairSchema.parse(review.pair ?? DEFAULT_PAIR);
  if (makePair(pair.base, pair.quote).id !== pair.id) throw new AppError(ErrorCode.MarketTradeReviewAmountsMismatch);
  const sizeRaw = parseQuantity(review.quantity, pair.base.decimals);
  if ((review.side === "buy" ? review.outputRaw : review.inputRaw) !== sizeRaw) throw new AppError(ErrorCode.MarketTradeReviewAmountsMismatch);
  const inputAsset = (review.side === "buy" ? pair.quote : pair.base);
  const outputAsset = (review.side === "buy" ? pair.base : pair.quote);
  if (review.inputSymbol !== inputAsset.symbol || review.outputSymbol !== outputAsset.symbol ||
      rawAmount(review.inputRaw) !== new D(review.principal).mul(new D(10).pow(inputAsset.decimals)).toFixed() ||
      rawAmount(review.outputRaw) !== new D(review.estimatedOutput).mul(new D(10).pow(outputAsset.decimals)).toFixed() ||
      new D(review.minimumOutput).gt(review.estimatedOutput))
    throw new AppError(ErrorCode.MarketTradeReviewAmountsMismatch);
  let payload: Record<string, unknown>;
  try { payload = object(JSON.parse(review.payload)); } catch { throw new AppError(ErrorCode.InvalidMarketSigningPayload); }
  if (payload.signer_id !== accountId || payload.verifying_contract !== (review.confidentiality === "advanced" ? PRIVATE_VERIFIER : VERIFIER) || !(Date.parse(review.expiresAt) > now) ||
      !(Date.parse(String(payload.deadline)) >= Date.parse(review.expiresAt)))
    throw new AppError(ErrorCode.MarketTradeIdentityOrDeadlineMismatch);
  if (!Array.isArray(payload.intents) || payload.intents.length !== 1) throw new AppError(ErrorCode.ExpectedOneMarketSwapIntent);
  const swap = object(payload.intents[0]);
  if (review.confidentiality === "advanced") {
    validatePrivateTransfer(payload, review.depositAddress, inputAsset.assetId, review.inputRaw);
  } else if (swap.intent === "token_diff") {
    const diff = object(swap.diff, ErrorCode.InvalidMarketSwapTokenAmounts);
    if (Object.keys(diff).length !== 2 || diff[inputAsset.assetId] !== `-${review.inputRaw}` || diff[outputAsset.assetId] !== review.outputRaw)
      throw new AppError(ErrorCode.OneClickSigningPayloadDiffersFromTheReviewedQuote);
  } else if (swap.intent === "transfer") {
    const tokens = object(swap.tokens, ErrorCode.InvalidMarketFundingAmount);
    if (swap.receiver_id !== review.depositAddress || Object.keys(tokens).length !== 1 || tokens[inputAsset.assetId] !== review.inputRaw)
      throw new AppError(ErrorCode.OneClickSigningPayloadDiffersFromTheReviewedQuote);
  } else {
    throw new AppError(ErrorCode.OneClickReturnedAnUnsupportedMarketIntent);
  }
  if (payloadChallenge(review.payload).toString("base64url") !== review.challenge)
    throw new AppError(ErrorCode.MarketSigningChallengeMismatch);
  return review;
}

export async function publishMarketIntent(signed: SignedWebAuthn, jwt: string, fetcher: typeof fetch = fetch) {
  if (!jwt.trim()) throw new AppError(ErrorCode.OneClickExecutionIsNotConfigured);
  const response = await providerFetch(fetcher, SUBMIT_INTENT_ENDPOINT, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: authHeaders(jwt),
    body: JSON.stringify({ type: "swap_transfer", signedData: signed }),
  });
  let data: unknown;
  try { data = await response.json(); } catch { throw new AppError(ErrorCode.OneClickReturnedAnInvalidSubmissionResponse); }
  const root = object(data, ErrorCode.InvalidOneClickSubmissionResponse);
  if (!response.ok) throw new AppError(ErrorCode.MarketTradeSubmissionDidNotCompleteCheckStatusBeforeRetrying);
  const intentHash = text(root.intentHash, ErrorCode.OneClickReturnedNoIntentHash);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(intentHash)) throw new AppError(ErrorCode.OneClickReturnedAnInvalidIntentHash);
  return { intentHash };
}
