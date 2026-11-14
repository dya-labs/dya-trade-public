"use client";
import { ActivitySummary } from "@dya/wallet-ui/components/near/activity-summary";
import { ActivityDetailRow } from "@dya/ui/components/activity-detail";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { Button } from "@dya/ui/components/button";
import type { StoredOrder } from "@/lib/near/http/schemas/trading";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { orderStatus, orderSettlement } from "@/lib/near/domain/order-display";
import { D } from "@/lib/near/domain/decimal";
import { limitSizes } from "./activity-model";
import { ActivityTime } from "./activity-time";
import { ActivityTransactions } from "./activity-transactions";

export function LimitOrderDetail({ order, status = orderStatus(order), recoveryMessage, fetching, onCheckStatus }: {
  order: StoredOrder; status?: string; recoveryMessage?: string; fetching?: boolean; onCheckStatus?: () => void;
}) {
  const pair = order.preview.pair ?? DEFAULT_PAIR, base = displaySymbol(pair.base), sizes = limitSizes(order);
  const settlement = orderSettlement(order);
  const uncertain = !!recoveryMessage || !!order.syncError || order.state === "unknown" || order.fundingState === "unknown" || order.cancelPending || order.provider?.payoutStatus === "FAILED";
  return <ActivitySummary title={`Limit ${order.preview.side} · ${status}`} direction={order.preview.side === "buy" ? "in" : "out"} asset={pair.base} symbol={base} amount={order.preview.quantity} subtitle={<ActivityTime value={order.createdAt} />}>
    <ActivityDetailRow label="Market">{base}/{pair.quote.symbol}</ActivityDetailRow>
    <ActivityDetailRow label="Limit price"><FormattedNumber value={order.preview.price} format="price" symbol={pair.quote.symbol} exactTooltip /></ActivityDetailRow>
    <ActivityDetailRow label="Order value"><FormattedNumber value={new D(order.preview.quantity).mul(order.preview.price).toFixed()} symbol={pair.quote.symbol} exactTooltip /></ActivityDetailRow>
    <ActivityDetailRow label="Filled"><FormattedNumber value={sizes.filled} symbol={base} exactTooltip /></ActivityDetailRow>
    <ActivityDetailRow label="Remaining"><FormattedNumber value={sizes.remaining} symbol={base} exactTooltip /></ActivityDetailRow>
    <ActivityDetailRow label="Expires"><ActivityTime value={Date.parse(order.preview.request?.data.attributes.deadline ?? "")} /></ActivityDetailRow>
    {order.syncError && <ActivityDetailRow label="Last known status">{orderStatus(order)}</ActivityDetailRow>}
    {settlement && <ActivityDetailRow label="Settlement">{settlement}</ActivityDetailRow>}
    {uncertain && <p role="status" className="text-muted-foreground">{recoveryMessage ?? "Check status before retrying an action. Funding or settlement may still be in progress."}</p>}
    <ActivityTransactions network="NEAR" hashes={order.provider?.payoutTxHashes} label="Payout transaction" />
    <ActivityTransactions network="NEAR" hashes={order.provider?.refundTxHash ? [order.provider.refundTxHash] : []} label="Refund transaction" />
    {uncertain && onCheckStatus && <Button className="w-full" variant="outline" disabled={fetching} onClick={onCheckStatus}>Check status</Button>}
  </ActivitySummary>;
}
