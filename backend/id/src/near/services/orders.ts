import { sameFeePlan } from "./fee-verification";
import { accountIdentity } from "../auth/intents";
import { StorageUnavailableError } from "../repositories/storage-error";
import { ConfidentialAccessRequired } from "../../../../../packages/wallet-contracts/src/domain/confidential-access-error";
import { AppError, ErrorCode, errorMessages, LimitOrderAmountTooSmallError } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { randomUUID } from "node:crypto";
import { accountFor, type StateStore } from "../repositories/store";
import { type LimitPreview } from "../../../../../packages/wallet-contracts/src/domain/limit-preview";
import { type OneClickOrders, type ProviderOrder, ProviderError } from "../providers/one-click";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";

function creationRejected(reason?: string) {
  // Normalize only the provider's explicit minimum explanation for presentation.
  // This never determines mutation safety or introduces a local minimum policy.
  const minimum = /^Limit order amount must be at least ([0-9]{1,12}(?:\.[0-9]{1,12})?) USD\.?$/.exec(reason ?? "")?.[1];
  if (minimum && new D(minimum).gt(0)) return new LimitOrderAmountTooSmallError(new D(minimum).toFixed(Math.max(2, new D(minimum).decimalPlaces())));
  return new AppError(ErrorCode.LimitOrderRejected, reason);
}

export const CREATION_LEASE_MS = 60_000;

export interface StoredOrder {
  id: string;
  ownerId: string;
  requestId: string;
  preparationIds?: string[];
  terms: string;
  preview: LimitPreview;
  createdAt: number;
  updatedAt: number;
  state: "creating" | "created" | "failed" | "unknown";
  provider?: ProviderOrder;
  cancelPending?: boolean;
  fundingState?: "submitting" | "submitted" | "unknown";
  fundingIntentHash?: string;
  syncError?: string;
  creationRejection?: { status: number; code: string; reason?: string };
}
async function owner(store: StateStore, session: string | undefined) {
  return await store.read(s => {
    const account = accountFor(s, session);
    if (account?.kind !== "passkey" || !account.publicKey) throw new AppError(ErrorCode.ConnectAPasskeyToManageOrders);
    return { id: account.id, accountId: accountIdentity(account).accountId };
  });
}
export async function listOrders(store: StateStore, session: string | undefined) {
  const account = await owner(store, session);
  return await store.read(s => Object.values(s.liveOrders ?? {}).filter(o => o.ownerId === account.id && o.preview.request.data.attributes.confidentiality === "advanced" && o.preview.request.data.attributes.depositType === "CONFIDENTIAL_INTENTS").sort((a,b) => b.createdAt - a.createdAt));
}
// Mutations require an explicitly supplied provider service and enablement.
export class OrderService {
  constructor(private store: StateStore, private provider: Pick<OneClickOrders, "create" | "get" | "cancel"> & Partial<Pick<OneClickOrders, "find">>, private enabled = false) {}
  async create(session: string | undefined, requestId: string, preview: LimitPreview) {
    if (!this.enabled) throw new AppError(ErrorCode.RealOrderSubmissionIsDisabled);
    const account = await owner(this.store, session);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new AppError(ErrorCode.InvalidRequestID);
    if (preview.request.data.attributes.recipient !== account.accountId || preview.request.data.attributes.refundTo !== account.accountId) throw new AppError(ErrorCode.OrderAccountMismatch);
    const terms = JSON.stringify({ request: preview.request, feePlan: preview.feePlan });
    const comparable = (value: LimitPreview) => JSON.stringify({ ...value.request.data.attributes, deadline: undefined });
    const claimed = await this.store.transaction(s => {
      if (accountFor(s, session)?.id !== account.id) throw new AppError(ErrorCode.SessionChanged);
      s.liveOrders ??= {};
      const prior = Object.values(s.liveOrders).find(o => o.ownerId === account.id && (o.requestId === requestId || o.preparationIds?.includes(requestId)));
      if (prior) {
        if (!sameFeePlan(prior.preview.feePlan, preview.feePlan) || comparable(prior.preview) !== comparable(preview)) throw new AppError(ErrorCode.RequestIDAlreadyUsedForDifferentTerms);
        return { order: prior, send: false };
      }
      const requested = preview.request.data.attributes;
      const resumable = Object.values(s.liveOrders).find(o => {
        if (!sameFeePlan(o.preview.feePlan, preview.feePlan) || o.ownerId !== account.id || !["creating", "created", "unknown"].includes(o.state)) return false;
        if (o.provider && (o.provider.fillStatus !== "AWAITING_DEPOSIT" || o.provider.depositedAmount !== "0")) return false;
        const existing = o.preview.request.data.attributes;
        return existing.confidentiality === requested.confidentiality && existing.depositType === requested.depositType && existing.refundType === requested.refundType && existing.recipientType === requested.recipientType && existing.side === requested.side && existing.quantity === requested.quantity && existing.price === requested.price &&
          existing.baseAsset === requested.baseAsset && existing.quoteAsset === requested.quoteAsset &&
          existing.recipient === requested.recipient && existing.refundTo === requested.refundTo && Date.parse(existing.deadline) > Date.now();
      });
      if (resumable) { resumable.preparationIds = [...new Set([...(resumable.preparationIds ?? []), requestId])]; return { order: resumable, send: false }; }
      const order: StoredOrder = { id: randomUUID(), ownerId: account.id, requestId, terms, preview: structuredClone(preview), createdAt: Date.now(), updatedAt: Date.now(), state: "creating" };
      s.liveOrders[order.id] = order;
      return { order, send: true };
    });
    if (!claimed.send) {
      if (claimed.order.state === "failed" && !claimed.order.provider) throw creationRejected(claimed.order.creationRejection?.reason);
      return claimed.order;
    }
    try {
      const provider = await this.provider.create(preview, account.accountId);
      return await this.store.transaction(s => {
        const order = s.liveOrders![claimed.order.id];
        order.provider = provider; order.state = "created"; order.updatedAt = Date.now();
        return order;
      });
    } catch (e) {
      if (e instanceof StorageUnavailableError) throw e;
      await this.store.transaction(s => {
        const order = s.liveOrders![claimed.order.id];
        // Unknown errors are conservative: never permit a duplicate create.
        order.state = e instanceof ConfidentialAccessRequired || e instanceof ProviderError && !e.outcomeUnknown ? "failed" : "unknown";
        if (e instanceof ProviderError && !e.outcomeUnknown) order.creationRejection = { status: e.status, code: e.code, ...(e.rejectionReason ? { reason: e.rejectionReason } : {}) };
        order.updatedAt = Date.now();
      });
      if (e instanceof ConfidentialAccessRequired) throw e;
      if (e instanceof ProviderError && !e.outcomeUnknown) throw creationRejected(e.rejectionReason);
      throw new AppError(ErrorCode.OrderCreationDidNotCompleteCheckOrderStatusBeforeRetrying);
    }
  }
  async sync(session: string | undefined, localId: string, cancel = false) {
    if (cancel && !this.enabled) throw new AppError(ErrorCode.RealOrderCancellationIsDisabled);
    const account = await owner(this.store, session);
    let order = await this.store.read(s => {
      const o = s.liveOrders?.[localId];
      if (!o || o.ownerId !== account.id) throw new AppError(ErrorCode.OrderNotFound);
      return o;
    });
    const a = order.preview.request.data.attributes;
    if (a.confidentiality !== "advanced" || a.depositType !== "CONFIDENTIAL_INTENTS") throw new AppError(ErrorCode.LegacyPublicOrdersCannotBeManagedThroughConfidential);
    const baseBinding = { ...(order.preview.feePlan ? { feePlan: order.preview.feePlan } : {}), accountId: account.accountId, deadline: a.deadline, baseAsset: a.baseAsset, quoteAsset: a.quoteAsset, side: a.side as "BUY" | "SELL", quantity: a.quantity, price: a.price };
    if (!order.provider) {
      if ((order.state !== "unknown" && !(order.state === "creating" && Date.now() - order.updatedAt >= CREATION_LEASE_MS)) || !this.provider.find)
        throw new AppError(ErrorCode.CreationOutcomeNeedsReconciliationNoProviderIDIsAvailable);
      const reconciled = await this.provider.find(baseBinding, order.createdAt);
      order = await this.store.transaction(s => {
        const current = s.liveOrders![localId];
        if (current.provider) return current;
        current.provider = reconciled; current.state = "created"; current.updatedAt = Date.now();
        return current;
      });
    }
    if (cancel) await this.store.transaction(s => { if (accountFor(s, session)?.id !== account.id) throw new AppError(ErrorCode.SessionChanged); s.liveOrders![localId].cancelPending = true; });
    const binding = { ...baseBinding, id: order.provider!.id };
    try {
      const result = await (cancel ? this.provider.cancel(binding) : this.provider.get(binding));
      return await this.store.transaction(s => {
        const current = s.liveOrders![localId];
        // Ignore an older concurrent status read rather than overwriting newer state.
        if (current.updatedAt !== order.updatedAt) return current;
        current.provider = result;
        current.cancelPending = result.fillStatus === "PENDING_CANCEL" || (current.cancelPending && !["FILLED", "CANCELED", "EXPIRED"].includes(result.fillStatus));
        current.updatedAt = Math.max(Date.now(), current.updatedAt + 1);
        delete current.syncError;
        return current;
      });
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw error;
      await this.store.transaction(s => {
        const current = s.liveOrders![localId];
        current.syncError = errorMessages[ErrorCode.ProviderStatusUnavailableLastConfirmedStateRetained]();
      });
      if (error instanceof ConfidentialAccessRequired) throw error;
      throw new AppError(ErrorCode.ProviderStatusUnavailableLastConfirmedStateRetained);
    }
  }
}
