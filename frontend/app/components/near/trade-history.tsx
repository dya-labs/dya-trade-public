"use client";
import { ActivityTable as Table } from "./activity-table";
import { useState } from "react";
import { ActivityEmpty, ActivityRecovery, ActivityRefreshStatus, oldestUpdate } from "./activity-state";
import { TableSkeletonRows } from "@dya/ui/components/table-skeleton";
import { DialogDrawer } from "@dya/ui/components/dialog-drawer";
import { ActivityDetailContent as DialogDrawerContent } from "@dya/ui/components/activity-detail";
import { TableHeader, TableBody, TableHead, TableRow, TableCell } from "@dya/ui/components/table";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import type { SelectedPair } from "@/lib/near/domain/catalog";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { ExecutionDetail } from "./execution-detail";
import { useOrders, useMarketTrades } from "./use-activity";
import { executionRows } from "./activity-model";
import { ActivityTime } from "./activity-time";

export function TradeHistory({ accountId, selectedPair }: { accountId: string | null; selectedPair?: SelectedPair }) {
  const orders = useOrders(accountId), trades = useMarketTrades(accountId);
  const rows = executionRows(orders.data ?? [], trades.data ?? [], selectedPair);
  const [selectedId, select] = useState("");
  const selected = rows.find(row => row.id === selectedId);
  const unavailable = !!orders.error || !!trades.error;
  const loading = !orders.data && orders.isPending || !trades.data && trades.isPending;
  const fetching = orders.isFetching || trades.isFetching;
  const refresh = () => { void orders.refetch(); void trades.refetch(); };
  return <section aria-label="Trade history" className="space-y-3 px-4 [&>[data-slot=table-container]]:-mx-4 [&>[data-slot=table-container]]:w-[calc(100%+2rem)] [&_table_tr>:first-child]:pl-4 [&_table_tr>:last-child]:pr-4">
    {!accountId ? <ActivityEmpty className="-mx-4">Sign in to view trade history.</ActivityEmpty> : <>
      {!rows.length && !loading && (unavailable ? <ActivityRecovery onRetry={refresh} retrying={fetching}>Couldn’t load trade history</ActivityRecovery> : <ActivityEmpty className="-mx-4">No executions yet.</ActivityEmpty>)}
      {(rows.length > 0 || loading) && <Table loading={loading && !rows.length} loadingLabel="Loading trade history" columnWidths={[176, 128, 128, 72, 144, 144, 144]} aria-label="Trade history" className="min-w-[820px]">
        <TableHeader><TableRow>{["Time", "Type", "Market", "Side", "Size", "Effective price", "Trade value"].map((label, i) => <TableHead key={label} className={i >= 4 ? "text-right" : undefined}>{label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{loading && !rows.length && <TableSkeletonRows columns={7} />}{rows.map(row => {
          const base = displaySymbol(row.pair.base), quote = row.pair.quote.symbol;
          return <TableRow key={row.id} tabIndex={0} aria-label={`View ${row.type.toLowerCase()} ${row.side} ${base} execution`} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]" onClick={() => select(row.id)} onKeyDown={event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); select(row.id); } }}>
            <TableCell><ActivityTime value={row.time} updated={row.timeIsUpdate} />{row.timeIsUpdate && <span className="block text-xs text-muted-foreground">Last updated</span>}</TableCell>
            <TableCell>{row.type}{row.unavailable && <span className="block text-xs text-muted-foreground">Amounts unavailable</span>}</TableCell>
            <TableCell>{base}/{quote}</TableCell><TableCell className={row.side === "buy" ? "text-market-up" : "text-market-down"}>{row.side === "buy" ? "Buy" : "Sell"}</TableCell>
            <TableCell className="text-right"><FormattedNumber value={row.size} symbol={base} exactTooltip /></TableCell>
            <TableCell className="text-right"><FormattedNumber value={row.price} format="price" symbol={quote} exactTooltip /></TableCell>
            <TableCell className="text-right"><FormattedNumber value={row.side === "buy" ? row.input : row.output} symbol={quote} exactTooltip /></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>}
      {unavailable && rows.length > 0 && <ActivityRefreshStatus lastUpdatedAt={oldestUpdate(orders.dataUpdatedAt, trades.dataUpdatedAt)} onRetry={refresh} retrying={fetching} />}
    </>}
    <DialogDrawer open={!!accountId && !!selected} onOpenChange={open => { if (!open) select(""); }}><DialogDrawerContent>{selected && <ExecutionDetail execution={selected} />}</DialogDrawerContent></DialogDrawer>
  </section>;
}
