"use client";
import { ActivitySummary } from "@dya/wallet-ui/components/near/activity-summary";
import { ActivityDetailRow } from "@dya/ui/components/activity-detail";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import type { ExecutionRow } from "./activity-model";
import { ActivityTime } from "./activity-time";
import { ActivityTransactions } from "./activity-transactions";

export function ExecutionDetail({ execution }: { execution: ExecutionRow }) {
  const e = execution, base = displaySymbol(e.pair.base);
  const hashes = "provider" in e.source ? e.source.provider?.payoutTxHashes : "nearTxHashes" in e.source ? e.source.nearTxHashes : [];
  return <ActivitySummary title={`${e.side === "buy" ? "Bought" : "Sold"} ${base}`} direction={e.side === "buy" ? "in" : "out"} asset={e.pair.base} symbol={base} amount={e.size} subtitle={<><ActivityTime value={e.time} updated={e.timeIsUpdate} />{e.timeIsUpdate && <span> · Last updated</span>}</>}>
    {e.unavailable && <p className="text-muted-foreground">Actual amounts are unavailable for this execution record. Quoted amounts are not shown as execution amounts.</p>}
    <ActivityDetailRow label="Type">{e.type} execution</ActivityDetailRow>
    <ActivityDetailRow label="Market">{base}/{e.pair.quote.symbol}</ActivityDetailRow>
    <ActivityDetailRow label="Paid"><FormattedNumber value={e.input} symbol={e.side === "buy" ? e.pair.quote.symbol : base} exactTooltip /></ActivityDetailRow>
    <ActivityDetailRow label="Received"><FormattedNumber value={e.output} symbol={e.side === "buy" ? base : e.pair.quote.symbol} exactTooltip /></ActivityDetailRow>
    <ActivityDetailRow label="Effective price"><FormattedNumber value={e.price} format="price" symbol={e.pair.quote.symbol} exactTooltip /></ActivityDetailRow>
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">About effective price</summary><p className="mt-2">Ratio of confirmed quote and base amounts, including costs already included in those amounts.</p></details>
    <ActivityTransactions network="NEAR" hashes={hashes} />
  </ActivitySummary>;
}
