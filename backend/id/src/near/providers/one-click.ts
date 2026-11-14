import { requestedAppFees, verifyFeeAllocations } from "../services/fee-verification";
import type { FeePlan, FeeReceipt } from "../../../../../packages/wallet-contracts/src/domain/trading-fees";
import { ConfidentialAccessRequired } from "../../../../../packages/wallet-contracts/src/domain/confidential-access-error";
import { providerFetch, ONE_CLICK_BASE, oneClickHeaders } from "./http";
import { ACTIVE_PAIR } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { AppError, ErrorCode, errorMessages } from "../../../../../packages/wallet-contracts/src/domain/errors";

import { type LimitPreview } from "../../../../../packages/wallet-contracts/src/domain/limit-preview";

const ENDPOINT = `${ONE_CLICK_BASE}/v0/orders`;
const STATUSES = ["AWAITING_DEPOSIT", "OPEN", "PARTIALLY_FILLED", "FILLED", "PENDING_CANCEL", "CANCELED", "EXPIRED", "UNTRIGGERED"] as const;
type FillStatus = typeof STATUSES[number];
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(ErrorCode.InvalidOneClickResponse);
  return value as ObjectValue;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 1024) throw new AppError(ErrorCode.InvalidOneClickString);
  return value;
}
function amount(value: unknown): string {
  const v = string(value);
  if (!/^(0|[1-9][0-9]{0,77})$/.test(v)) throw new AppError(ErrorCode.InvalidOneClickAmount);
  return v;
}
function orderId(value: unknown): string {
  const id = string(value);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new AppError(ErrorCode.InvalidOrderID);
  return id;
}
export interface OrderBinding {
  feePlan?: FeePlan;
  id?: string;
  baseAsset?: string;
  quoteAsset?: string;
  accountId: string;
  deadline?: string;
  side: "BUY" | "SELL";
  quantity: string;
  price: string;
}
export interface ProviderOrder {
  feeReceipt?: FeeReceipt;
  id: string;
  fillStatus: FillStatus;
  payoutStatus: string;
  payoutFinal: boolean;
  depositAddress: string;
  depositMemo?: string;
  fundingAmount: string;
  inputAsset: string;
  depositedAmount: string;
  partialFills: { id: string; amountIn: string; amountOut: string; createdAt?: number }[];
  payoutTxHashes?: string[];
  refundTxHash?: string;
}
// Bind each response to the original server-owned order, not to caller-supplied IDs.
export function parseOrder(value: unknown, binding: OrderBinding): ProviderOrder {
  if (binding.feePlan && binding.feePlan.kind !== "limit") throw new AppError(ErrorCode.TradingFeeVerificationFailed);
  const baseAsset = binding.baseAsset ?? ACTIVE_PAIR.base.assetId;
  const quoteAsset = binding.quoteAsset ?? ACTIVE_PAIR.quote.assetId;
  const data = object(object(value).data), a = object(data.attributes);
  const id = orderId(data.id);
  if (data.type !== "orders" || (binding.id && id !== binding.id) ||
      a.confidentiality !== "advanced" || a.timeInForce !== "GTC" || (binding.deadline !== undefined && a.deadline !== binding.deadline) || a.orderType !== "LIMIT" || a.baseAsset !== baseAsset ||
      a.quoteAsset !== quoteAsset || a.side !== binding.side ||
      a.quantity !== binding.quantity || a.price !== binding.price ||
      a.recipient !== binding.accountId || a.refundTo !== binding.accountId ||
      a.depositType !== "CONFIDENTIAL_INTENTS" || a.recipientType !== "CONFIDENTIAL_INTENTS" || a.refundType !== "CONFIDENTIAL_INTENTS")
    throw new AppError(ErrorCode.OneClickOrderDoesNotMatchTheRequestedAccountOrTerms);
  if (!STATUSES.includes(a.fillStatus as FillStatus) || typeof a.isPayoutStatusFinal !== "boolean") throw new AppError(ErrorCode.UnknownOneClickOrderState);
  const swap = object(a.swapView), buy = binding.side === "BUY";
  const inputAsset = (buy ? quoteAsset : baseAsset);
  if (swap.swapType !== (buy ? "EXACT_OUTPUT" : "EXACT_INPUT") ||
      swap.originAsset !== inputAsset || swap.destinationAsset !== (buy ? baseAsset : quoteAsset))
    throw new AppError(ErrorCode.OneClickFundingAssetMismatch);
  if (!Array.isArray(a.partialFills)) throw new AppError(ErrorCode.MissingPartialFills);
  const fills = a.partialFills.map(value => {
    const f = object(value);
    const createdAt = typeof f.createdAt === "string" ? Date.parse(f.createdAt) : NaN;
    return { id: string(f.id), amountIn: amount(f.amountIn), amountOut: amount(f.amountOut), ...(Number.isFinite(createdAt) && createdAt >= 0 ? { createdAt } : {}) };
  });
  if (new Set(fills.map(f => f.id)).size !== fills.length) throw new AppError(ErrorCode.DuplicatePartialFill);
  const payoutStatus = string(a.payoutStatus);
  if (a.isPayoutStatusFinal && !["COMPLETED", "FAILED"].includes(payoutStatus)) throw new AppError(ErrorCode.InconsistentPayoutFinality);
  const payouts = a.payouts === undefined ? null : object(a.payouts);
  function completedHash(value: unknown) {
    if (value === null || value === undefined) return undefined;
    const leg = object(value);
    return leg.status === "COMPLETED" ? string(leg.txHash) : undefined;
  }
  const allWithdrawals = payouts?.allWithdrawals;
  if (allWithdrawals !== undefined && !Array.isArray(allWithdrawals)) throw new AppError(ErrorCode.InvalidOrderPayouts);
  const payoutTxHashes = payouts ? [...new Set([
    ...(Array.isArray(allWithdrawals) ? allWithdrawals.map(completedHash) : []),
    completedHash(payouts.withdrawal),
  ].filter((hash): hash is string => !!hash))] : [];
  const refundTxHash = payouts ? completedHash(payouts.refund) : undefined;
  return {
    ...(binding.feePlan ? { feeReceipt: verifyFeeAllocations(a.appFees, binding.feePlan) } : {}),
    id, fillStatus: a.fillStatus as FillStatus, payoutStatus,
    payoutFinal: a.isPayoutStatusFinal,
    depositAddress: string(a.depositAddress),
    ...(a.depositMemo === undefined ? {} : { depositMemo: string(a.depositMemo) }),
    fundingAmount: amount(swap[buy ? "maxAmountIn" : "amountIn"]),
    inputAsset, depositedAmount: amount(a.depositedAmount), partialFills: fills,
    ...(payouts ? { payoutTxHashes } : {}),
    ...(refundTxHash ? { refundTxHash } : {}),
  };
}
// Keep upstream code separate from our stable internal classification.
export class ProviderError extends Error {
  readonly errorCode: ErrorCode;
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly outcomeUnknown: boolean,
    public readonly retryAfterSeconds?: number,
    public readonly rejectionReason?: string,
  ) { super(outcomeUnknown ? errorMessages[ErrorCode.ProviderOutcomeUnknown]() : errorMessages[ErrorCode.ProviderRequestFailed](status, code));
    this.errorCode = outcomeUnknown ? ErrorCode.ProviderOutcomeUnknown : ErrorCode.ProviderRequestFailed; }
}
export class OneClickOrders {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly allowMutations = false,
    private readonly accessToken?: string,
  ) {}
  private async request(path: string, method: "GET" | "POST", body?: unknown) {
    if (method === "POST" && !this.allowMutations) throw new AppError(ErrorCode.OneClickMutationsDisabled);
    if (!this.apiKey.trim()) throw new AppError(ErrorCode.OneClickPartnerCredentialsAreNotConfigured);
    let response: Response;
    try {
      response = await providerFetch(this.fetcher, ENDPOINT + path, {
        method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12000),
        headers: { ...oneClickHeaders(this.apiKey, "api-key"), ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      // Never automatically retry a mutation: a lost response may hide a successful create.
      throw new ProviderError(0, "transport-error", method === "POST");
    }
    if (response.status === 401 && this.accessToken) throw new ConfidentialAccessRequired();
    if (response.status === 204 && path.endsWith("/cancel")) return null;
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new ProviderError(response.status, "invalid-response", method === "POST"); }
    if (!response.ok) {
      const payload = object(data);
      const first = Array.isArray(payload.errors) ? payload.errors[0] : undefined;
      const code = first && typeof first === "object" && typeof first.code === "string" && /^[a-z-]{1,64}$/.test(first.code) ? first.code : "unknown-error";
      const retry = response.headers.get("retry-after");
      const seconds = retry && /^[0-9]{1,6}$/.test(retry) ? Number(retry) : undefined;
      // Explanatory text is display-only. Never infer retry safety or workflow state from it.
      // Keep unknown/authentication errors generic and exclude echoed identifiers and URLs.
      const detail = first && typeof first === "object" && typeof first.detail === "string" ? first.detail.trim() : "";
      const rejectionReason = response.status === 400 && code === "order-rejected" && detail.length > 0 && detail.length <= 240 &&
        !/[\x00-\x1f\x7f]|https?:|[A-Za-z0-9_-]{40,}/.test(detail) ? detail : undefined;
      throw new ProviderError(response.status, code, method === "POST" && response.status >= 500, seconds, rejectionReason);
    }
    return data;
  }
  async create(preview: LimitPreview, accountId: string) {
    const a = preview.request.data.attributes;
    if (!/^0x[0-9a-f]{40}$/.test(accountId) || a.recipient !== accountId || a.refundTo !== accountId ||
        !a.baseAsset || !a.quoteAsset || a.baseAsset === a.quoteAsset ||
        a.orderType !== "LIMIT" || !["BUY", "SELL"].includes(a.side) ||
        a.depositType !== "CONFIDENTIAL_INTENTS" || a.refundType !== "CONFIDENTIAL_INTENTS" || a.recipientType !== "CONFIDENTIAL_INTENTS" ||
        a.confidentiality !== "advanced" || a.timeInForce !== "GTC" ||
        !Number.isFinite(Date.parse(a.deadline)) || Date.parse(a.deadline) <= Date.now())
      throw new AppError(ErrorCode.InvalidServerOrderRequest);
    amount(a.quantity);
    if (!/^[0-9]+(\.[0-9]+)?$/.test(a.price) || Number(a.price) <= 0 || BigInt(a.quantity) === BigInt(0)) throw new AppError(ErrorCode.InvalidOrderSizeOrPrice);
    const binding: OrderBinding = { ...(preview.feePlan ? { feePlan: preview.feePlan } : {}), accountId, deadline: a.deadline, baseAsset: a.baseAsset, quoteAsset: a.quoteAsset, side: a.side as "BUY" | "SELL", quantity: a.quantity, price: a.price };
    // Reconstruct only allowed fields; never forward arbitrary browser/provider objects.
    const body = { data: { type: "orders", attributes: {
      ...(preview.feePlan ? { appFees: requestedAppFees(preview.feePlan, "limit") } : {}),
      orderType: "LIMIT", baseAsset: a.baseAsset, quoteAsset: a.quoteAsset,
      quantity: a.quantity, price: a.price, side: a.side, deadline: a.deadline,
      recipient: accountId, refundTo: accountId, depositType: "CONFIDENTIAL_INTENTS",
      recipientType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS", confidentiality: "advanced", timeInForce: "GTC",
    } } };
    const result = await this.request("", "POST", body);
    try { return parseOrder(result, binding); }
    catch {
      try {
        const data = object(object(result).data);
        return await this.get({ ...binding, id: orderId(data.id) });
      } catch { throw new ProviderError(201, "invalid-response", true); }
    }
  }
  async find(binding: OrderBinding, createdAt: number) {
    const result = object(await this.request("?page%5Bsize%5D=50", "GET"));
    if (!Array.isArray(result.data)) throw new AppError(ErrorCode.InvalidOneClickOrderList);
    const matches: ProviderOrder[] = [];
    for (const value of result.data) {
      try {
        const data = object(value), attributes = object(data.attributes);
        const timestamp = Date.parse(String(attributes.createdAt));
        if (!Number.isFinite(timestamp) || timestamp < createdAt - 120000 || timestamp > createdAt + 600000) continue;
        matches.push(parseOrder({ data }, binding));
      } catch { /* Ignore unrelated or malformed rows. */ }
    }
    if (matches.length !== 1) throw new AppError(ErrorCode.CouldNotUniquelyReconcileTheOneClickOrder);
    return matches[0];
  }
  async get(binding: OrderBinding & { id: string }) {
    return parseOrder(await this.request("/" + orderId(binding.id), "GET"), binding);
  }
  async cancel(binding: OrderBinding & { id: string }) {
    await this.request("/" + orderId(binding.id) + "/cancel", "POST");
    // Cancellation acknowledgement is not settlement. Always fetch authoritative state.
    return this.get(binding);
  }
}
