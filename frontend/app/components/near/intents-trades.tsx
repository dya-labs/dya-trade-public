"use client";
import { ActivityTable as Table } from "./activity-table";
import { useState } from "react";
import { ActivitySummary } from "@dya/wallet-ui/components/near/activity-summary";
import { ActivityDetailRow } from "@dya/ui/components/activity-detail";
import { DialogDrawer } from "@dya/ui/components/dialog-drawer";
import { ActivityDetailContent as DialogDrawerContent } from "@dya/ui/components/activity-detail";
import { ActivityTransactions } from "./activity-transactions";
import type { CatalogAsset } from "@/lib/near/domain/catalog";
import type { IntentsTrade } from "@/lib/market-data/api";
import { D } from "@/lib/near/domain/decimal";
import { ActivityTime } from "./activity-time";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { ActivityEmpty, ActivityRecovery, ActivityRefreshStatus } from "./activity-state";
import { TableSkeletonRows } from "@dya/ui/components/table-skeleton";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dya/ui/components/table";
import { useIntentsTrades } from "@/lib/market-data/hooks";

/**
 * The newest public NEAR Intents trades of a market (last 24 h), as charted on its Intents chart, each linking its NEAR
 * transaction.
 */
export function IntentsTrades({ marketId, base, baseAsset }: { marketId: string; base: string; baseAsset?: CatalogAsset }) {
  const query = useIntentsTrades(marketId);
  const trades = query.data ?? [];
  const [selection, select] = useState<{ marketId: string; trade: IntentsTrade } | null>(null);
  const selected = selection?.marketId === marketId ? selection.trade : undefined;
  const refresh = () => { void query.refetch(); };
  return <section aria-label="Market trades" className="space-y-4 px-4 [&>[data-slot=table-container]]:-mx-4 [&>[data-slot=table-container]]:w-[calc(100%+2rem)] [&_table_tr>:first-child]:pl-4 [&_table_tr>:last-child]:pr-4">
    {!query.isPending && !trades.length && (query.error ? <ActivityRecovery onRetry={refresh} retrying={query.isFetching}>Couldn’t load trades</ActivityRecovery> : <ActivityEmpty className="-mx-4">No public trades in the last 24 hours.</ActivityEmpty>)}
    {(query.isPending || !!trades.length) && <Table aria-label="Market trades" className="min-w-[520px]" columnWidths={[160, 72, 144, 144]} loading={query.isPending} loadingLabel="Loading trades">
      <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Side</TableHead><TableHead className="text-right">Price (USD)</TableHead><TableHead className="text-right">Size ({base})</TableHead></TableRow></TableHeader>
      <TableBody>
        {query.isPending && <TableSkeletonRows columns={4} />}
        {trades.map((trade, i) => {
          return <TableRow key={`${trade.txHash}:${trade.time}:${i}`} tabIndex={0} aria-label={`View public ${trade.side} ${base} trade details`} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]" onClick={event => { if (!(event.target as HTMLElement).closest("button,a")) select({ marketId, trade }); }} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); select({ marketId, trade }); } }}>
            <TableCell><ActivityTime value={trade.time} /></TableCell>
            <TableCell className={trade.side === "buy" ? "text-market-up" : "text-market-down"}>{trade.side === "buy" ? "Buy" : "Sell"}</TableCell>
            <TableCell className="text-right font-mono tabular-nums"><FormattedNumber value={trade.price} format="price" /></TableCell>
            <TableCell className="text-right font-mono tabular-nums"><FormattedNumber value={trade.quantity} exactTooltip /></TableCell>
          </TableRow>;
        })}
      </TableBody>
    </Table>}
    {query.error && trades.length > 0 && <ActivityRefreshStatus lastUpdatedAt={query.dataUpdatedAt || undefined} onRetry={refresh} retrying={query.isFetching} />}
    <DialogDrawer open={!!selected} onOpenChange={open => { if (!open) select(null); }}><DialogDrawerContent>{selected && <ActivitySummary title={`Public ${selected.side} · ${base}`} direction={selected.side === "buy" ? "in" : "out"} asset={baseAsset} symbol={base} amount={selected.quantity} usdValue={new D(selected.price).mul(selected.quantity).toFixed()} subtitle={<ActivityTime value={selected.time} />} note="Public market activity. This is not necessarily your trade; confidential trades are not visible.">
      <ActivityDetailRow label="Price"><FormattedNumber value={selected.price} format="price" symbol="USD" exactTooltip /></ActivityDetailRow>
      <ActivityDetailRow label="Route">NEAR Intents</ActivityDetailRow>
      <ActivityTransactions network="NEAR" hashes={[selected.txHash]} />
    </ActivitySummary>}</DialogDrawerContent></DialogDrawer>
  </section>;
}
