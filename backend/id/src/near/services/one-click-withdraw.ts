import { PRIVATE_VERIFIER, privateAssetId, validatePrivateTransfer } from "../../../../../packages/wallet-contracts/src/domain/confidential";
import { tokenAllowed, type TokenRecord } from "../../../../../packages/wallet-contracts/src/domain/token-registry";
import { catalogSchema, type CatalogAsset } from "../../../../../packages/wallet-contracts/src/domain/catalog";
import { resolveWithdrawalAssets } from "../../../../../packages/wallet-contracts/src/domain/withdrawal-assets";
import { networkName } from "../../../../../packages/wallet-contracts/src/domain/deposit-assets";
import { providerFetch, ONE_CLICK_BASE, oneClickHeaders } from "../providers/http";
import { ACTIVE_PAIR, balanceFor } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";
import { type LiveBalances } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { payloadChallenge, publicRpc, VERIFIER, type SignedWebAuthn } from "../auth/intents";
import { nearAccount } from "./transfers";

const BASE = ONE_CLICK_BASE;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(ErrorCode.InvalidOneClickWithdrawalResponse);
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 8192) throw new AppError(ErrorCode.InvalidOneClickWithdrawalResponse);
  return value;
}
function raw(value: unknown): string {
  const result = string(value);
  if (!/^[1-9][0-9]{0,77}$/.test(result)) throw new AppError(ErrorCode.InvalidOneClickWithdrawalAmount);
  return result;
}
function address(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new AppError(ErrorCode.EnterAValidBSCDestinationWallet);
  return value;
}
function depositId(value: unknown): string {
  const result = string(value);
  if (result.length > 256 || /[\s\u0000-\u001f\u007f]/.test(result)) throw new AppError(ErrorCode.InvalidOneClickWithdrawalIdentifier);
  return result;
}
async function ensureWNearRecipient(wallet: string, fetcher: typeof fetch) {
  const response = await publicRpc(JSON.stringify({ jsonrpc: "2.0", id: "wnear-recipient", method: "query", params: {
    request_type: "call_function", finality: "final", account_id: "wrap.near",
    method_name: "storage_balance_of", args_base64: Buffer.from(JSON.stringify({ account_id: wallet })).toString("base64"),
  } }), fetcher);
  let result: unknown;
  try { result = await response.json(); } catch { throw new AppError(ErrorCode.UnableToVerifyDestinationWNEARRegistration); }
  const root = object(result);
  const rpcResult = root.result && typeof root.result === "object" ? object(root.result) : null;
  if (!response.ok || root.error || !rpcResult || !Array.isArray(rpcResult.result) ||
      !rpcResult.result.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255))
    throw new AppError(ErrorCode.UnableToVerifyDestinationWNEARRegistration);
  let balance: unknown;
  try { balance = JSON.parse(Buffer.from(rpcResult.result).toString("utf8")); } catch { throw new AppError(ErrorCode.InvalidWNEARRegistrationResponse); }
  if (!balance || typeof balance !== "object") throw new AppError(ErrorCode.DestinationNEARAccountIsNotRegisteredToReceiveWNEAR);
}
function headers(jwt: string) { return oneClickHeaders(jwt, "api-key"); }
async function json(response: Response) {
  try { return await response.json(); } catch { throw new AppError(ErrorCode.OneClickReturnedInvalidWithdrawalData); }
}
export interface WithdrawalReview {
  confidentiality?: "advanced";
  direction: "withdraw";
  sourceChain: "NEAR Intents";
  destinationChain: string;
  route?: { origin: CatalogAsset; destination: CatalogAsset };
  asset: string;
  amount: string;
  amountRaw: string;
  destinationWallet: string;
  destinationAsset: string;
  originAsset: string;
  expectedReceive: string;
  minimumReceive: string;
  available: string;
  balanceBlock: number;
  deadline: string;
  depositAddress: string;
  depositMemo: null;
  payload: string;
  challenge: string;
  correlationId: string;
}

export async function prepareWithdrawal(body: Record<string, unknown>, balances: LiveBalances, jwt: string, fetcher: typeof fetch = fetch, now = Date.now(), catalog?: CatalogAsset[], confidential = false, registry?: TokenRecord[], internalRecipient?: string): Promise<WithdrawalReview> {
  if (!jwt.trim()) throw new AppError(ErrorCode.OneClickWithdrawalsAreNotConfigured);
  const explicit = body.originAssetId !== undefined || body.destinationAssetId !== undefined;
  const route = explicit ? resolveWithdrawalAssets(catalog ?? [], body.originAssetId, body.destinationAssetId) : undefined;
  if (!route && body.asset !== "USDC" && body.asset !== "wNEAR") throw new AppError(ErrorCode.ChooseUSDCOrWNEAR);
  const asset = route?.origin.symbol ?? body.asset as string;
  const near = route ? route.destination.assetId === ACTIVE_PAIR.base.assetId : asset === "wNEAR";
  const chain = route?.destination.blockchain ?? (near ? "near" : "bsc");
  const evm = ["eth", "bsc", "arb", "base", "pol", "avax", "op", "gnosis", "bera", "berachain", "aurora"].includes(chain);
  const destinationWallet = internalRecipient ?? (chain === "near" ? nearAccount(body.wallet) : evm ? address(body.wallet) : depositId(body.wallet));
  if (near && !internalRecipient) await ensureWNearRecipient(destinationWallet, fetcher);
  const input = balanceFor(balances, route?.origin.assetId ?? (near ? ACTIVE_PAIR.base : ACTIVE_PAIR.quote).assetId, route?.origin);
  const amount = body.amount;
  if (typeof amount !== "string" || !/^(0|[1-9][0-9]{0,11})(\.[0-9]+)?$/.test(amount) ||
      (amount.split(".")[1]?.length ?? 0) > input.decimals || new D(amount).lte(0))
    throw new AppError(ErrorCode.PositiveAssetAmountRequired, asset);
  const amountRaw = new D(amount).mul(new D(10).pow(input.decimals)).toFixed(0);
  if (new D(amountRaw).gt(input.raw)) throw new AppError(ErrorCode.InsufficientIntentsBalance, asset);
  const tokensResponse = await providerFetch(fetcher, `${BASE}/v0/tokens`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
  const tokens = await json(tokensResponse);
  if (!tokensResponse.ok || !Array.isArray(tokens)) throw new AppError(ErrorCode.OneClickTokenDiscoveryUnavailable);
  const matches = tokens.filter(value => {
    const token = object(value);
    if (route) return token.assetId === route.destination.assetId && token.blockchain === chain && token.symbol === route.destination.symbol && token.decimals === route.destination.decimals;
    return token.blockchain === (near ? "near" : "bsc") && token.symbol === asset &&
      typeof token.assetId === "string" && Number.isInteger(token.decimals) &&
      (!near || token.assetId === ACTIVE_PAIR.base.assetId);
  });
  if (matches.length !== 1) throw new AppError(ErrorCode.AmbiguousDestinationAsset, asset);
  const destinationAsset = string(object(matches[0]).assetId);
  if (registry) {
    const observed = catalogSchema.parse(tokens).find(a => a.assetId === destinationAsset);
    if (!observed || !tokenAllowed(observed, registry.find(t => t.id === observed.assetId), "withdrawals")) throw new AppError(ErrorCode.TokenOperationUnavailable);
  }
  const destinationDecimals = object(matches[0]).decimals;
  if (typeof destinationDecimals !== "number" || destinationDecimals < 0 || destinationDecimals > 38 ||
      (near && destinationDecimals !== 24)) throw new AppError(ErrorCode.InvalidDestinationTokenPrecision);
  const request = {
    ...(confidential ? { confidentiality: "advanced" } : {}),
    dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100,
    originAsset: input.assetId, depositType: confidential ? "CONFIDENTIAL_INTENTS" : "INTENTS",
    destinationAsset, amount: amountRaw,
    refundTo: balances.accountId, refundType: confidential ? "CONFIDENTIAL_INTENTS" : "INTENTS",
    recipient: destinationWallet, recipientType: internalRecipient ? "CONFIDENTIAL_INTENTS" : "DESTINATION_CHAIN",
    deadline: new Date(now + 15 * 60_000).toISOString(), quoteWaitingTimeMs: 3000,
  } as const;
  const quoteResponse = await providerFetch(fetcher, `${BASE}/v0/quote`, { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000), headers: headers(jwt), body: JSON.stringify(request) });
  const result = object(await json(quoteResponse));
  if (!quoteResponse.ok) throw new AppError(quoteResponse.status === 401 || quoteResponse.status === 403 ? ErrorCode.OneClickWithdrawalCredentialsWereRejected : ErrorCode.WithdrawalQuoteUnavailable);
  const echoed = object(result.quoteRequest), quote = object(result.quote);
  for (const key of ["swapType", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType", "slippageTolerance"] as const)
    if (echoed[key] !== request[key]) throw new AppError(ErrorCode.WithdrawalQuoteDoesNotMatchTheRequestedRoute);
  if (typeof echoed.deadline !== "string" || Date.parse(echoed.deadline) !== Date.parse(request.deadline))
    throw new AppError(ErrorCode.WithdrawalQuoteDoesNotMatchTheRequestedRoute);
  if (confidential && echoed.confidentiality !== "advanced") throw new AppError(ErrorCode.ConfidentialQuoteRequired);
  if (echoed.dry !== false) throw new AppError(ErrorCode.OneClickReturnedADryWithdrawalQuote);
  const depositAddress = depositId(quote.depositAddress);
  if (quote.depositMemo !== undefined && quote.depositMemo !== null) throw new AppError(ErrorCode.MemoBasedWithdrawalFundingIsNotSupported);
  if (raw(quote.amountIn) !== amountRaw) throw new AppError(ErrorCode.WithdrawalQuoteChangedTheDebitAmount);
  const expectedReceive = new D(raw(quote.amountOut)).div(new D(10).pow(destinationDecimals)).toFixed();
  const minimumReceive = new D(raw(quote.minAmountOut)).div(new D(10).pow(destinationDecimals)).toFixed();
  if (new D(minimumReceive).gt(expectedReceive)) throw new AppError(ErrorCode.InvalidWithdrawalMinimum);
  const quoteExpiry = Date.parse(string(quote.deadline));
  if (!Number.isFinite(quoteExpiry) || quoteExpiry <= now + 15_000) throw new AppError(ErrorCode.WithdrawalQuoteExpiresTooSoon);
  const generateResponse = await providerFetch(fetcher, `${BASE}/v0/generate-intent`, { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000), headers: headers(jwt), body: JSON.stringify({ type: "swap_transfer", standard: "webauthn", signerId: balances.accountId, depositAddress }) });
  const generated = object(await json(generateResponse));
  if (!generateResponse.ok) throw new AppError(ErrorCode.OneClickCouldNotPrepareTheWithdrawalSignature);
  const intent = object(generated.intent);
  if (intent.standard !== "webauthn") throw new AppError(ErrorCode.UnsupportedWithdrawalSigningStandard);
  const payload = string(intent.payload);
  const payloadExpiry = Date.parse(String(object(JSON.parse(payload)).deadline));
  if (!Number.isFinite(payloadExpiry) || payloadExpiry <= now + 15_000 || payloadExpiry > quoteExpiry) throw new AppError(ErrorCode.WithdrawalSignatureExpiresTooSoon);
  // 1Click refunds a transfer that is not completed by the requested deadline; the
  // signed intent and quote.deadline (the address expiry) can outlive it.
  const deadline = new Date(Math.min(payloadExpiry, Date.parse(request.deadline))).toISOString();
  const review: WithdrawalReview = { ...(confidential ? { confidentiality: "advanced" as const } : {}), direction: "withdraw", sourceChain: "NEAR Intents", destinationChain: internalRecipient ? "Confidential Intents" : networkName(chain), ...(route ? { route } : {}), asset, amount: new D(amount).toFixed(), amountRaw, destinationWallet, destinationAsset, originAsset: input.assetId, expectedReceive, minimumReceive, available: input.amount, balanceBlock: balances.blockHeight, deadline, depositAddress, depositMemo: null, payload, challenge: payloadChallenge(payload).toString("base64url"), correlationId: string(generated.correlationId) };
  validateWithdrawal(review, balances.accountId, now);
  return review;
}

export function validateWithdrawal(review: WithdrawalReview, accountId: string, now = Date.now()) {
  const payload = object(JSON.parse(review.payload));
  const expiry = Date.parse(string(payload.deadline));
  if (payload.signer_id !== accountId || payload.verifying_contract !== (review.confidentiality === "advanced" ? PRIVATE_VERIFIER : VERIFIER) || !(Date.parse(review.deadline) > now) || !(expiry >= Date.parse(review.deadline))) throw new AppError(ErrorCode.WithdrawalIdentityOrDeadlineMismatch);
  if (!Array.isArray(payload.intents) || payload.intents.length !== 1) throw new AppError(ErrorCode.ExpectedOneWithdrawalIntent);
  const intent = object(payload.intents[0]);
  if (intent.intent !== "transfer" || intent.receiver_id !== review.depositAddress) throw new AppError(ErrorCode.UnsupportedWithdrawalFundingIntent);
  const tokens = object(intent.tokens);
  if (review.route) {
    const { origin, destination } = resolveWithdrawalAssets([review.route.origin, ...(review.route.destination.assetId === review.route.origin.assetId ? [] : [review.route.destination])], review.originAsset, review.destinationAsset);
    if (review.asset !== origin.symbol || (review.destinationChain !== networkName(destination.blockchain) && !(review.confidentiality === "advanced" && review.destinationChain === "Confidential Intents" && origin.assetId === destination.assetId)) || new D(review.amount).mul(new D(10).pow(origin.decimals)).toFixed() !== review.amountRaw) throw new AppError(ErrorCode.WithdrawalSigningPayloadDiffersFromReview);
  }
  const expectedAsset = review.route?.origin.assetId ?? (review.asset === "wNEAR" ? ACTIVE_PAIR.base.assetId : ACTIVE_PAIR.quote.assetId);
  if (review.originAsset !== expectedAsset || (!review.route && review.asset === "wNEAR" && review.destinationAsset !== ACTIVE_PAIR.base.assetId) ||
      (!review.route && review.destinationChain !== (review.asset === "wNEAR" ? "NEAR" : "BNB Smart Chain")) ||
      Object.keys(tokens).length !== 1 || tokens[review.confidentiality === "advanced" ? privateAssetId(expectedAsset) : expectedAsset] !== review.amountRaw) throw new AppError(ErrorCode.WithdrawalSigningPayloadDiffersFromReview);
  if (review.confidentiality === "advanced") validatePrivateTransfer(payload, review.depositAddress, expectedAsset, review.amountRaw);
  if (payloadChallenge(review.payload).toString("base64url") !== review.challenge) throw new AppError(ErrorCode.WithdrawalSigningChallengeMismatch);
  return review;
}

export async function publishWithdrawal(signed: SignedWebAuthn, jwt: string, fetcher: typeof fetch = fetch) {
  if (!jwt.trim()) throw new AppError(ErrorCode.OneClickWithdrawalsAreNotConfigured);
  const response = await providerFetch(fetcher, `${BASE}/v0/submit-intent`, { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000), headers: headers(jwt), body: JSON.stringify({ type: "swap_transfer", signedData: signed }) });
  const result = object(await json(response));
  if (!response.ok) throw new AppError(ErrorCode.WithdrawalSubmissionOutcomeIsUnknownCheckStatusBeforeRetrying);
  const intentHash = string(result.intentHash);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(intentHash)) throw new AppError(ErrorCode.OneClickReturnedAnInvalidWithdrawalIntentHash);
  return { intentHash };
}
