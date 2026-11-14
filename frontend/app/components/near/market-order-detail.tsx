"use client";
import { ActivitySummary } from "@dya/wallet-ui/components/near/activity-summary";
import { ActivityDetailRow } from "@dya/ui/components/activity-detail";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { Button } from "@dya/ui/components/button";
import type { Trade } from "@/lib/near/http/schemas/trading";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { executionRows } from "./activity-model";
import { ActivityTime } from "./activity-time";
import { ActivityTransactions } from "./activity-transactions";

export function MarketOrderDetail({ trade, status, uncertain, fetching, onCheckStatus }: { trade: Trade; status: string; uncertain: boolean; fetching?: boolean; onCheckStatus: () => void }) {
  const pair = trade.review.pair ?? DEFAULT_PAIR, base = displaySymbol(pair.base), actual = executionRows([], [trade])[0];
  return <ActivitySummary title={`Market ${trade.review.side} · ${status}`} direction={trade.review.side === "buy" ? "in" : "out"} asset={pair.base} symbol={base} amount={actual?.size ?? trade.review.quantity} subtitle={<ActivityTime value={trade.createdAt} />}>
    <ActivityDetailRow label="Market">{base}/{pair.quote.symbol}</ActivityDetailRow>
    <ActivityDetailRow label="Original size"><FormattedNumber value={trade.review.quantity} symbol={base} exactTooltip /></ActivityDetailRow>
    <ActivityDetailRow label="Filled"><FormattedNumber value={actual?.size} symbol={base} exactTooltip /></ActivityDetailRow>
    {actual && !actual.unavailable ? <>
      <ActivityDetailRow label="Paid"><FormattedNumber value={actual.input} symbol={trade.review.inputSymbol} exactTooltip /></ActivityDetailRow>
      <ActivityDetailRow label="Received"><FormattedNumber value={actual.output} symbol={trade.review.outputSymbol} exactTooltip /></ActivityDetailRow>
      <ActivityDetailRow label="Effective price"><FormattedNumber value={actual.price} format="price" symbol={pair.quote.symbol} exactTooltip /></ActivityDetailRow>
    </> : <p className="text-xs text-muted-foreground">Amount shown is the original order size. Confirmed execution amounts are unavailable.</p>}
    {uncertain && <p role="status" className="text-muted-foreground">The outcome is unconfirmed. Check status before retrying.</p>}
    <ActivityTransactions network="NEAR" hashes={trade.nearTxHashes} />
    <details className="space-y-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Reviewed quote</summary><ActivityDetailRow label="Quoted input"><FormattedNumber value={trade.review.principal} symbol={trade.review.inputSymbol} exactTooltip /></ActivityDetailRow><ActivityDetailRow label="Estimated output"><FormattedNumber value={trade.review.estimatedOutput} symbol={trade.review.outputSymbol} exactTooltip /></ActivityDetailRow></details>
    {uncertain && <Button className="w-full" variant="outline" disabled={fetching} onClick={onCheckStatus}>Check status</Button>}
  </ActivitySummary>;
}
