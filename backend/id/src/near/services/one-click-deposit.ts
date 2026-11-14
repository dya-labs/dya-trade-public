import { tokenAllowed, type TokenRecord } from "../../../../../packages/wallet-contracts/src/domain/token-registry";
import { isSupportedStablecoin } from "../../../../../packages/wallet-contracts/src/domain/stablecoins";
import { validNetworkRefundAddress, validRefundInput } from "../../../../../packages/wallet-contracts/src/domain/refund-security";
import { providerFetch, ONE_CLICK_BASE, oneClickHeaders } from "../providers/http";
import { catalogSchema, quantityRaw } from "../../../../../packages/wallet-contracts/src/domain/catalog";
import { resolveDepositAssets, networkName } from "../../../../../packages/wallet-contracts/src/domain/deposit-assets";
import { displaySymbol } from "../../../../../packages/wallet-contracts/src/domain/canonical-assets";
import { ACTIVE_PAIR } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { AppError, ErrorCode, type StaticErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";


const BASE = ONE_CLICK_BASE;
const TERMINAL = ["SUCCESS", "REFUNDED", "FAILED"] as const;
const STATUSES = ["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", ...TERMINAL] as const;
// Deposits arriving after the requested deadline are refunded (QUOTE_EXPIRED).
// The quote's own `deadline` is later: when 1Click stops watching the address.
const DEPOSIT_WINDOW_MS = 3 * 24 * 60 * 60_000;

function object(value: unknown, message: StaticErrorCode = ErrorCode.InvalidOneClickResponse) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(message);
  return value as Record<string, unknown>;
}
function string(value: unknown, message: StaticErrorCode = ErrorCode.InvalidOneClickResponse) {
  if (typeof value !== "string" || !value.length || value.length > 2048) throw new AppError(message);
  return value;
}
function evmAddress(value: unknown) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new AppError(ErrorCode.InvalidRefundAddress);
  return value;
}
function providerDepositId(value: unknown) {
  const result = string(value, ErrorCode.InvalidOneClickDepositIdentifier);
  if (result.length > 256 || /[\s\u0000-\u001f\u007f]/.test(result))
    throw new AppError(ErrorCode.InvalidOneClickDepositIdentifier);
  return result;
}
async function json(response: Response, context: string) {
  try { return await response.json(); }
  catch { throw new AppError(ErrorCode.InvalidOneClickContextResponse, context); }
}

export async function createDepositQuote(body: Record<string, unknown>, accountId: string, jwt: string, fetcher: typeof fetch = fetch, now = Date.now(), confidential = false, tokens?: TokenRecord[], configuredRefundAddress?: string) {
  if (!/^0x[0-9a-f]{40}$/.test(accountId) && !(confidential && /^[0-9a-f]{64}$/.test(accountId))) throw new AppError(ErrorCode.InvalidIntentsAccount);
  if (confidential && (!configuredRefundAddress || !validRefundInput(configuredRefundAddress))) throw new AppError(ErrorCode.NetworkTransferUnavailable);

  if (!jwt.trim()) throw new AppError(ErrorCode.OneClickDepositsAreNotConfiguredAddONECLICKJWT);

  const tokenResponse = await providerFetch(fetcher, `${BASE}/v0/tokens`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
  const tokenPayload = await json(tokenResponse, "token");
  if (!tokenResponse.ok || !Array.isArray(tokenPayload)) throw new AppError(ErrorCode.OneClickTokenDiscoveryUnavailable);
  const catalog = catalogSchema.parse(tokenPayload);
  const explicit = body.sourceAssetId !== undefined || body.targetAssetId !== undefined;
  let source, target;
  if (explicit) {
    try { ({ source, target } = resolveDepositAssets(catalog, body.targetAssetId, body.sourceAssetId, tokens)); }
    catch { throw new AppError(ErrorCode.ChooseASupportedTransferRoute); }
  } else {
    // Compatibility for previously deployed clients only; the new UI requires
    // explicit source selection and never defaults the network.
    const matches = catalog.filter(a => a.blockchain === "bsc" && a.symbol === "USDC");
    if (matches.length !== 1) throw new AppError(ErrorCode.OneClickDoesNotExposeOneUnambiguousBSCUSDCAsset);
    source = matches[0];
    target = confidential ? source : { ...ACTIVE_PAIR.quote, blockchain: "near" };
  }
  if (tokens && (!tokenAllowed(source, tokens.find(t => t.id === source.assetId), "deposits") || !tokenAllowed(target, tokens.find(t => t.id === target.assetId), "deposits"))) throw new AppError(ErrorCode.TokenOperationUnavailable);
  if (confidential && isSupportedStablecoin(source) && target.assetId !== source.assetId)
    throw new AppError(ErrorCode.StablecoinDepositsMustPreserveTheSourceAsset);
  if (confidential && !validNetworkRefundAddress({ id: source.blockchain, addressKind: source.blockchain === "near" ? "near" : configuredRefundAddress!.startsWith("0x") && configuredRefundAddress!.length === 42 ? "evm" : "provider" }, configuredRefundAddress!)) throw new AppError(ErrorCode.NetworkTransferUnavailable);
  const originAsset = source.assetId;
  const discoverMinimum = confidential && body.amount === undefined;
  // Discover the technical minimum independently of the $1 UI buffer.
  const price = new D(source.price ?? 0);
  const amount = discoverMinimum
    ? new D(1).div(new D(10).pow(source.decimals)).toFixed()
    : body.amount;
  const parsed = { formatted: new D(string(amount)).toFixed(), raw: quantityRaw(amount, source.decimals) };
  const refundType = "ORIGIN_CHAIN" as const;
  const refundTo = confidential ? configuredRefundAddress! : source.blockchain === "bsc" || ["eth", "base", "arb", "op", "pol", "avax"].includes(source.blockchain)
    ? evmAddress(body.wallet) : providerDepositId(body.wallet);
  let request = {
    ...(confidential ? { confidentiality: "advanced" } : {}),
    dry: false, swapType: confidential ? "FLEX_INPUT" : "EXACT_INPUT", slippageTolerance: 100,
    originAsset, depositType: "ORIGIN_CHAIN",
    destinationAsset: target.assetId, amount: parsed.raw,
    refundTo, refundType, recipient: accountId, recipientType: confidential ? "CONFIDENTIAL_INTENTS" : "INTENTS",
    deadline: new Date(now + DEPOSIT_WINDOW_MS).toISOString(), quoteWaitingTimeMs: 3000,
  } as const;
  const fetchQuote = async () => {
    const response = await providerFetch(fetcher, `${BASE}/v0/quote`, {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: oneClickHeaders(jwt, "api-key"), body: JSON.stringify(request),
    });
    return { response, payload: object(await json(response, "deposit quote")) };
  };
  let { response, payload } = await fetchQuote();
  for (let attempt = 0; discoverMinimum && !response.ok && attempt < 2; attempt++) {
    const match = typeof payload.message === "string" && /^Amount is too low for bridge, try at least ([1-9][0-9]{0,38})$/.exec(payload.message);
    if (!match) break;
    const next = new D(match[1]).mul(100).div(99).ceil();
    if (next.lte(request.amount)) break;
    parsed.raw = next.toFixed(0);
    parsed.formatted = next.div(new D(10).pow(source.decimals)).toFixed();
    request = { ...request, amount: parsed.raw };
    ({ response, payload } = await fetchQuote());
  }
  if (!response.ok && payload.message === "Quoting for this pair is not available")
    throw new AppError(ErrorCode.DepositNetworkUnavailable);
  if (!response.ok && payload.message === "No liquidity available") throw new AppError(ErrorCode.DepositRouteUnavailable);
  if (!response.ok && payload.message === "refundTo is not valid") throw new AppError(ErrorCode.InvalidRefundAddress);
  if (!response.ok) {
    const messages = typeof payload.message === "string" ? [payload.message]
      : Array.isArray(payload.message) ? payload.message.filter((value): value is string => typeof value === "string") : [];
    const message = messages.join(" ").toLowerCase();
    // Only fixed vocabulary is emitted; provider text may contain echoed private values.
    const fields = ["amount", "deadline", "swapType", "originAsset", "destinationAsset", "refundTo", "recipient", "depositType", "recipientType", "refundType", "confidentiality", "slippageTolerance", "quoteWaitingTimeMs"]
      .filter(field => message.includes(field.toLowerCase()));
    const rules = ["required", "not valid", "not supported", "must", "too low", "too high", "minimum", "maximum", "expired", "liquidity", "quotes", "zero", "flex_input", "any_input", "exact_input", "exact_output"]
      .filter(rule => message.includes(rule));
    const category = response.status === 401 || response.status === 403 ? "credentials"
      : message.includes("amount") ? "amount"
      : message.includes("confidential") ? "confidentiality"
      : message.includes("refund") ? "refund"
      : message.includes("recipient") ? "recipient"
      : message.includes("asset") || message.includes("token") ? "asset"
      : message.includes("swap") ? "swap-type"
      : response.status >= 500 ? "provider-unavailable" : "unclassified";
    console.error("wallet.deposit.quote-rejected", { status: response.status, category, fields, rules });
    throw new AppError(response.status === 401 || response.status === 403 ? ErrorCode.OneClickDepositCredentialsWereRejected : ErrorCode.OneClickDepositQuoteUnavailable);
  }
  const echoed = object(payload.quoteRequest), quote = object(payload.quote);
  for (const key of ["swapType", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType"] as const)
    if (echoed[key] !== request[key]) throw new AppError(ErrorCode.OneClickDepositQuoteDoesNotMatchTheRequestedRoute);
  if (typeof echoed.deadline !== "string" || Date.parse(echoed.deadline) !== Date.parse(request.deadline))
    throw new AppError(ErrorCode.OneClickDepositQuoteDoesNotMatchTheRequestedRoute);
  if (confidential && echoed.confidentiality !== "advanced") throw new AppError(ErrorCode.ConfidentialDepositRequired);
  if (echoed.dry !== false) throw new AppError(ErrorCode.OneClickReturnedADryDepositQuote);
  const raw = (value: unknown) => {
    const v = string(value);
    if (!/^(0|[1-9][0-9]{0,38})$/.test(v)) throw new AppError(ErrorCode.InvalidOneClickResponse);
    return new D(v);
  };
  if (!raw(quote.amountIn).eq(parsed.raw) ||
      !raw(quote.amountIn).div(new D(10).pow(source.decimals)).eq(string(quote.amountInFormatted)) ||
      !raw(quote.amountOut).div(new D(10).pow(target.decimals)).eq(string(quote.amountOutFormatted)) ||
      raw(quote.amountOut).lte(0) || raw(quote.minAmountOut).gt(raw(quote.amountOut)))
    throw new AppError(ErrorCode.OneClickDepositQuoteDoesNotMatchTheRequestedRoute);
  const minimum = confidential ? raw(quote.minAmountIn) : raw(quote.amountIn);
  if (minimum.lte(0) || minimum.gt(raw(quote.amountIn))) throw new AppError(ErrorCode.OneClickDepositQuoteDoesNotMatchTheRequestedRoute);

  const depositAddress = providerDepositId(quote.depositAddress);
  return {
    ...(confidential ? { confidentiality: "advanced" as const } : {}),
    ...(confidential ? { showDollarBuffer: price.gt(0) && minimum.div(new D(10).pow(source.decimals)).mul(price).lte(1), minAmountInFormatted: minimum.div(new D(10).pow(source.decimals)).toFixed() } : {}),
    direction: "deposit" as const, sourceChain: source.blockchain === "bsc" ? "BSC" : networkName(source.blockchain), asset: displaySymbol(target), amount: parsed.formatted,
    ...(explicit ? { sourceAssetId: source.assetId, targetAssetId: target.assetId, sourceNetwork: source.blockchain } : {}),
    refundTo, refundType, recipient: accountId, depositAddress,
    depositMemo: quote.depositMemo === undefined ? null : string(quote.depositMemo),
    amountIn: string(quote.amountIn), amountInFormatted: string(quote.amountInFormatted),
    amountOut: string(quote.amountOut), amountOutFormatted: string(quote.amountOutFormatted),
    minAmountOut: string(quote.minAmountOut), deadline: request.deadline,
    timeEstimateSeconds: typeof quote.timeEstimate === "number" && Number.isFinite(quote.timeEstimate) ? quote.timeEstimate : null,
    correlationId: string(payload.correlationId), signature: string(payload.signature),
    submissionEnabled: true as const,
  };
}

export type DepositQuote = Awaited<ReturnType<typeof createDepositQuote>>;

function transactionHashes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object" || !("hash" in item)) return [];
    const hash = item.hash;
    return typeof hash === "string" && hash.length > 0 && hash.length <= 128 ? [hash] : [];
  });
}

export async function readDepositStatus(body: Record<string, unknown>, jwt: string, fetcher: typeof fetch = fetch) {
  if (!jwt.trim()) throw new AppError(ErrorCode.OneClickDepositsAreNotConfiguredAddONECLICKJWT);
  const depositAddress = providerDepositId(body.depositAddress);
  const memo = body.depositMemo === null || body.depositMemo === undefined ? undefined : string(body.depositMemo);
  const query = new URLSearchParams({ depositAddress, ...(memo ? { depositMemo: memo } : {}) });
  const response = await providerFetch(fetcher, `${BASE}/v0/status?${query}`, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000), headers: oneClickHeaders(jwt, "api-key"),
  });
  const payload = object(await json(response, "deposit status"));
  if (!response.ok) throw new AppError(response.status === 401 || response.status === 403 ? ErrorCode.OneClickDepositCredentialsWereRejected : ErrorCode.OneClickDepositStatusUnavailable);
  if (!STATUSES.includes(payload.status as typeof STATUSES[number])) throw new AppError(ErrorCode.UnknownOneClickDepositStatus);
  const swap = payload.swapDetails && typeof payload.swapDetails === "object" && !Array.isArray(payload.swapDetails)
    ? payload.swapDetails as Record<string, unknown> : {};
  // Quotes carry the discovered minimum, not what was sent; only a settled swap reports the credited amount.
  const creditedAmount = payload.status === "SUCCESS" && typeof swap.amountOutFormatted === "string" && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(swap.amountOutFormatted) ? swap.amountOutFormatted : undefined;
  const settledAt = typeof payload.updatedAt === "string" ? Date.parse(payload.updatedAt) : NaN;
  const rawPattern = /^(0|[1-9][0-9]{0,77})$/;
  const formattedPattern = /^(0|[1-9][0-9]{0,77})(\.[0-9]{1,38})?$/;
  const execution = payload.status === "SUCCESS" && Number.isFinite(settledAt) && settledAt >= 0 &&
    typeof swap.amountIn === "string" && rawPattern.test(swap.amountIn) && new D(swap.amountIn).gt(0) &&
    typeof swap.amountOut === "string" && rawPattern.test(swap.amountOut) && new D(swap.amountOut).gt(0) &&
    typeof swap.amountInFormatted === "string" && formattedPattern.test(swap.amountInFormatted) &&
    typeof swap.amountOutFormatted === "string" && formattedPattern.test(swap.amountOutFormatted)
    ? { inputRaw: swap.amountIn, outputRaw: swap.amountOut, inputAmount: swap.amountInFormatted, outputAmount: swap.amountOutFormatted, settledAt } : undefined;
  return { status: payload.status as typeof STATUSES[number], terminal: TERMINAL.includes(payload.status as typeof TERMINAL[number]), updatedAt: string(payload.updatedAt), creditedAmount, execution, originChainTxHashes: transactionHashes(swap.originChainTxHashes), destinationChainTxHashes: transactionHashes(swap.destinationChainTxHashes), nearTxHashes: Array.isArray(swap.nearTxHashes) ? swap.nearTxHashes.filter((hash): hash is string => typeof hash === "string" && hash.length > 0 && hash.length <= 128) : [] };
}

export type DepositStatus = Awaited<ReturnType<typeof readDepositStatus>>;
