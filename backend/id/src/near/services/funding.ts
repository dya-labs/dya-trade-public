import { validateFeeReceipt } from "./fee-verification";
import { PRIVATE_VERIFIER, privateAssetId, validatePrivateTransfer } from "../../../../../packages/wallet-contracts/src/domain/confidential";
import { providerFetch, ONE_CLICK_BASE } from "../providers/http";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { payloadChallenge } from "../auth/intents";
import type { StoredOrder } from "./orders";


function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(ErrorCode.InvalidFundingPayload);
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new AppError(ErrorCode.UnsupportedFundingPayloadField);
}
export interface FundingReview {
  payload: string;
  challenge: string;
  expiresAt: number;
  orderId: string;
  providerId: string;
  assetId: string;
  amount: string;
  receiver: string;
}
// Narrow initial policy: one plain transfer, with exact known destination and amount.
// Other valid protocol forms require explicit review; never infer economics from a
// token_diff or silently accept extra intents just because the provider returned them.
export function validateFunding(value: unknown, order: StoredOrder, now = Date.now()): FundingReview {
  if (order.preview.request.data.attributes.depositType !== "CONFIDENTIAL_INTENTS" || order.preview.request.data.attributes.confidentiality !== "advanced" || order.preview.request.data.attributes.refundType !== "CONFIDENTIAL_INTENTS" || order.preview.request.data.attributes.recipientType !== "CONFIDENTIAL_INTENTS")
    throw new AppError(ErrorCode.AdvancedConfidentialFundingIsRequired);
  const provider = order.provider;
  if (order.state !== "created" || !provider || provider.fillStatus !== "AWAITING_DEPOSIT" ||
      provider.depositedAmount !== "0" || provider.partialFills.length || order.cancelPending || order.fundingState ||
      provider.depositMemo !== undefined)
    throw new AppError(ErrorCode.OrderIsNotEligibleForInitialFunding);
  if (order.preview.feePlan) {
    if (!provider.feeReceipt || order.preview.feePlan.kind !== "limit") throw new AppError(ErrorCode.TradingFeeVerificationFailed);
    validateFeeReceipt(provider.feeReceipt, order.preview.feePlan);
  }
  const account = order.preview.request.data.attributes.recipient;
  const expectedAsset = order.preview.side === "buy" ? order.preview.request.data.attributes.quoteAsset : order.preview.request.data.attributes.baseAsset;
  if (provider.inputAsset !== expectedAsset || !/^[1-9][0-9]{0,38}$/.test(provider.fundingAmount))
    throw new AppError(ErrorCode.InvalidExpectedFundingAmountOrAsset);
  const response = record(value), intent = record(response.intent);
  only(intent, ["standard", "payload"]);
  if (intent.standard !== "webauthn" || typeof intent.payload !== "string" || intent.payload.length > 16000)
    throw new AppError(ErrorCode.ExpectedWebAuthnFundingPayload);
  const p = record(JSON.parse(intent.payload));
  only(p, ["signer_id", "verifying_contract", "deadline", "nonce", "intents"]);
  const expiresAt = typeof p.deadline === "string" ? Date.parse(p.deadline) : NaN;
  if (p.signer_id !== account || p.verifying_contract !== PRIVATE_VERIFIER ||
      !Number.isFinite(expiresAt) || expiresAt <= now + 10000 ||
      expiresAt > Date.parse(order.preview.request.data.attributes.deadline))
    throw new AppError(ErrorCode.FundingIdentityOrDeadlineMismatch);
  if (typeof p.nonce !== "string" || Buffer.from(p.nonce, "base64").length !== 32 ||
      Buffer.from(p.nonce, "base64").toString("base64") !== p.nonce)
    throw new AppError(ErrorCode.InvalidFundingNonce);
  if (!Array.isArray(p.intents) || p.intents.length !== 1) throw new AppError(ErrorCode.ExpectedExactlyOneFundingTransfer);
  const transfer = record(p.intents[0]);
  only(transfer, ["intent", "receiver_id", "tokens"]);
  const tokens = record(transfer.tokens);
  if (transfer.intent !== "transfer" || transfer.receiver_id !== provider.depositAddress ||
      Object.keys(tokens).length !== 1 || tokens[privateAssetId(expectedAsset)] !== provider.fundingAmount)
    throw new AppError(ErrorCode.FundingTransferDiffersFromReviewedOrder);
  validatePrivateTransfer(p, provider.depositAddress, expectedAsset, provider.fundingAmount);
  return {
    payload: intent.payload, challenge: payloadChallenge(intent.payload).toString("base64url"),
    expiresAt, orderId: order.id, providerId: provider.id,
    assetId: expectedAsset, amount: provider.fundingAmount, receiver: provider.depositAddress,
  };
}
// Confidential orders are created with the user's 1Click session, and 1Click checks the caller
// owns a limit-order deposit address, so both funding calls carry that session with the partner key.
export async function generateFunding(order: StoredOrder, apiKey: string, accessToken: string, fetcher: typeof fetch = fetch, timeoutMs = 15_000) {
  if (order.preview.request.data.attributes.depositType !== "CONFIDENTIAL_INTENTS" || order.preview.request.data.attributes.confidentiality !== "advanced" || order.preview.request.data.attributes.refundType !== "CONFIDENTIAL_INTENTS" || order.preview.request.data.attributes.recipientType !== "CONFIDENTIAL_INTENTS")
    throw new AppError(ErrorCode.AdvancedConfidentialFundingIsRequired);
  if (!apiKey.trim()) throw new AppError(ErrorCode.OneClickPartnerCredentialsAreNotConfigured);
  if (!order.provider || order.state !== "created") throw new AppError(ErrorCode.NoConfirmedProviderOrder);
  let response: Response;
  try { response = await providerFetch(fetcher, `${ONE_CLICK_BASE}/v0/generate-intent`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      type: "swap_transfer", standard: "webauthn",
      signerId: order.preview.request.data.attributes.recipient,
      depositAddress: order.provider.depositAddress,
    }),
  }); } catch {
    throw new AppError(ErrorCode.TheOrderWasCreatedButPreparingFundingFailed);
  }
  if (!response.ok) throw new AppError(ErrorCode.OneClickCouldNotPrepareTheFundingSignature, response.status);
  return validateFunding(await response.json(), order);
}

export async function submitFunding(signed: import("../auth/intents").SignedWebAuthn, apiKey: string, accessToken: string, fetcher: typeof fetch = fetch) {
  if (!apiKey.trim()) throw new AppError(ErrorCode.OneClickPartnerCredentialsAreNotConfigured);
  const response = await providerFetch(fetcher, `${ONE_CLICK_BASE}/v0/submit-intent`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ type: "swap_transfer", signedData: signed }),
  });
  let data: unknown;
  try { data = await response.json(); } catch { throw new AppError(ErrorCode.OneClickReturnedAnInvalidFundingSubmissionResponse); }
  if (!response.ok || !data || typeof data !== "object" || Array.isArray(data))
    throw new AppError(ErrorCode.LimitOrderFundingSubmissionDidNotCompleteCheckOrdersBeforeRetrying);
  const intentHash = (data as Record<string, unknown>).intentHash;
  if (typeof intentHash !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(intentHash))
    throw new AppError(ErrorCode.OneClickReturnedAnInvalidFundingIntentHash);
  return { intentHash };
}
