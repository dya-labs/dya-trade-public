"use client";
import { ActivityTable as Table } from "./activity-table";
import { useState } from "react";
import { Button } from "@dya/ui/components/button";
import { ActivityEmpty, ActivityRecovery, ActivityRefreshStatus, oldestUpdate } from "./activity-state";
import { TableSkeletonRows } from "@dya/ui/components/table-skeleton";
import { DialogDrawer } from "@dya/ui/components/dialog-drawer";
import { ActivityDetailContent as DialogDrawerContent } from "@dya/ui/components/activity-detail";
import { TableHeader, TableBody, TableHead, TableRow, TableCell } from "@dya/ui/components/table";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { DEFAULT_PAIR, type SelectedPair } from "@/lib/near/domain/catalog";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { LimitOrderDetail } from "./limit-order-detail";
import { MarketOrderDetail } from "./market-order-detail";
import { orderStatus, orderSettlement } from "@/lib/near/domain/order-display";
import { useOrders, useMarketTrades } from "./use-activity";
import { inMarket, submittedLimit, limitSizes } from "./activity-model";
import { ActivityTime } from "./activity-time";

export function OrderHistory({ accountId, selectedPair }: { accountId: string | null; selectedPair?: SelectedPair }) {
  const orders = useOrders(accountId), trades = useMarketTrades(accountId);
  const rows = [
    ...(orders.data ?? []).filter(order => submittedLimit(order) && inMarket(order.preview.pair, selectedPair)).map(order => ({ id: `limit:${order.id}`, limitOrder: order, marketTrade: undefined, type: "Limit", pair: order.preview.pair ?? DEFAULT_PAIR, side: order.preview.side, size: order.preview.quantity, filled: limitSizes(order).filled, price: order.preview.price, time: order.createdAt, status: order.syncError ? "Status unavailable" : orderStatus(order), settlement: orderSettlement(order), uncertain: !!order.syncError || order.state === "unknown" })),
    ...(trades.data ?? []).filter(trade => inMarket(trade.review.pair, selectedPair)).map(trade => ({ id: `market:${trade.id}`, limitOrder: undefined, marketTrade: trade, type: "Market", pair: trade.review.pair ?? DEFAULT_PAIR, side: trade.review.side, size: trade.review.quantity, filled: trade.execution ? trade.review.side === "buy" ? trade.execution.outputAmount : trade.execution.inputAmount : null, price: null, time: trade.createdAt, status: trade.syncError ? "Status unavailable" : trade.state === "settled" ? "Completed" : trade.state === "failed" ? "Failed" : trade.state === "unknown" ? "Unconfirmed" : "Processing", settlement: null, uncertain: !!trade.syncError || trade.state === "unknown" })),
  ].sort((a, b) => b.time - a.time);
  const [selectedId, select] = useState("");
  const selected = rows.find(row => row.id === selectedId);
  const fetching = orders.isFetching || trades.isFetching;
  const refresh = () => { void orders.refetch(); void trades.refetch(); };
  const unavailable = !!orders.error || !!trades.error;
  const loading = !orders.data && orders.isPending || !trades.data && trades.isPending;
  return <section aria-label="Order history" className="space-y-3 px-4 [&>[data-slot=table-container]]:-mx-4 [&>[data-slot=table-container]]:w-[calc(100%+2rem)] [&_table_tr>:first-child]:pl-4 [&_table_tr>:last-child]:pr-4">
    {!accountId ? <ActivityEmpty className="-mx-4">Sign in to view order history.</ActivityEmpty> : <>
      {!rows.length && !loading && (unavailable ? <ActivityRecovery onRetry={refresh} retrying={fetching}>Couldn’t load order history</ActivityRecovery> : <ActivityEmpty className="-mx-4">No submitted orders yet.</ActivityEmpty>)}
      {(rows.length > 0 || loading) && <Table loading={loading && !rows.length} loadingLabel="Loading order history" columnWidths={[176, 88, 128, 72, 144, 144, 144, 128, 120]} aria-label="Order history" className="min-w-[850px]">
        <TableHeader><TableRow>{["Time", "Type", "Market", "Side", "Original size", "Filled", "Limit price", "Status", "Action"].map((label, i) => <TableHead key={label} className={i >= 4 && i <= 6 ? "text-right" : undefined}>{label === "Action" ? <span className="sr-only">Action</span> : label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{loading && !rows.length && <TableSkeletonRows columns={9} />}{rows.map(row => <TableRow key={row.id} tabIndex={0} aria-label={`View ${row.type.toLowerCase()} ${row.side} order history details`} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]" onClick={event => { if (!(event.target as HTMLElement).closest("button,a")) select(row.id); }} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); select(row.id); } }}>
          <TableCell><ActivityTime value={row.time} /></TableCell><TableCell>{row.type}</TableCell><TableCell>{displaySymbol(row.pair.base)}/{row.pair.quote.symbol}</TableCell><TableCell className={row.side === "buy" ? "text-market-up" : "text-market-down"}>{row.side === "buy" ? "Buy" : "Sell"}</TableCell>
          <TableCell className="text-right"><FormattedNumber value={row.size} symbol={displaySymbol(row.pair.base)} exactTooltip /></TableCell><TableCell className="text-right"><FormattedNumber value={row.filled} symbol={displaySymbol(row.pair.base)} exactTooltip /></TableCell><TableCell className="text-right">{row.type === "Market" ? "Market" : <FormattedNumber value={row.price} format="price" symbol={row.pair.quote.symbol} exactTooltip />}</TableCell>
          <TableCell><span className={row.uncertain || row.status === "Failed" ? "text-destructive" : undefined}>{row.status}</span>{row.settlement && <span className="block text-xs text-muted-foreground">{row.settlement}</span>}</TableCell><TableCell>{row.uncertain && <Button variant="outline" size="sm" disabled={fetching} onClick={refresh}>Check status</Button>}</TableCell>
        </TableRow>)}</TableBody>
      </Table>}
      {unavailable && rows.length > 0 && <ActivityRefreshStatus lastUpdatedAt={oldestUpdate(orders.dataUpdatedAt, trades.dataUpdatedAt)} onRetry={refresh} retrying={fetching} />}
    </>}
    <DialogDrawer open={!!accountId && !!selected} onOpenChange={open => { if (!open) select(""); }}><DialogDrawerContent>{selected?.limitOrder && <LimitOrderDetail order={selected.limitOrder} status={selected.status} fetching={fetching} onCheckStatus={refresh} />}{selected?.marketTrade && <MarketOrderDetail trade={selected.marketTrade} status={selected.status} uncertain={selected.uncertain} fetching={fetching} onCheckStatus={refresh} />}</DialogDrawerContent></DialogDrawer>
  </section>;
}
