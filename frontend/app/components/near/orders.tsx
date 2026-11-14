"use client";
import { OpenOrdersTable as Table, ordersSectionClass } from "./open-orders-table";
import { ActivityTime } from "./activity-time";
import { actionableLimit, pendingMarket, submittedLimit, inMarket, limitSizes } from "./activity-model";
import { D } from "@/lib/near/domain/decimal";
import type { SelectedPair } from "@/lib/near/domain/catalog";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, LoaderCircle, X } from "@dya/ui/icons";
import { TableSkeletonRows } from "@dya/ui/components/table-skeleton";
import { ActivityEmpty, ActivityRecovery, ActivityRefreshStatus, oldestUpdate } from "./activity-state";
import { Button } from "@dya/ui/components/button";
import { DialogDrawer } from "@dya/ui/components/dialog-drawer";
import { ActivityDetailContent as DialogDrawerContent } from "@dya/ui/components/activity-detail";
import { TableBody, TableCell, TableRow } from "@dya/ui/components/table";
import { cancelOrder as cancelOrderRequest } from "@/lib/near/http/trading-client";
import type { StoredOrder } from "@/lib/near/http/schemas/trading";
import { LimitOrderDetail } from "./limit-order-detail";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { orderSettlement, orderStatus } from "@/lib/near/domain/order-display";
import { MarketOrderDetail } from "./market-order-detail";
import { useOrders, useMarketTrades } from "./use-activity";


export function Orders({ accountId, mode = "all", selectedPair }: { accountId: string | null; mode?: "all" | "open" | "history"; selectedPair?: SelectedPair }) {
  const client = useQueryClient();
  const query = useOrders(accountId);
  const marketQuery = useMarketTrades(mode === "open" ? accountId : null);
  const pendingMarkets = mode === "open" ? (marketQuery.data ?? []).filter(trade => pendingMarket(trade, selectedPair)) : [];
  const [marketDetailsId, setMarketDetailsId] = useState("");
  const selectedMarket = pendingMarkets.find(trade => trade.id === marketDetailsId);
  const marketStatus = (trade: typeof pendingMarkets[number]) => trade.syncError ? "Status unavailable" : trade.state === "unknown" ? "Unconfirmed" : "Processing";
  const unavailable = query.error || (mode === "open" && marketQuery.error);
  const fetching = query.isFetching || (mode === "open" && marketQuery.isFetching);
  function refreshOrders() { void query.refetch(); if (mode === "open") void marketQuery.refetch(); }

  const orders = (query.data ?? []).filter(order => submittedLimit(order) && inMarket(order.preview.pair, selectedPair) && (mode !== "open" || actionableLimit(order)));
  const title = mode === "open" ? "Open orders" : mode === "history" ? "Order history" : "Orders";
  const [busyId, setBusyId] = useState("");
  const busy = useRef(false);
  const [cancelError, setCancelError] = useState<{ id: string; account: string | null } | null>(null);
  const [detailsId, setDetailsId] = useState("");
  const errorId = cancelError?.account === accountId ? cancelError.id : "";
  async function cancelOrder(id: string) {
    if (busy.current) return;
    busy.current = true; setBusyId(id); setCancelError(null);
    try {
      const result = await cancelOrderRequest(id);
      client.setQueryData<StoredOrder[]>(["near", "account", accountId, "orders", "confidential"], current => current?.map(order => order.id === id ? result.order : order));
      void client.invalidateQueries({ queryKey: ["near", "account", accountId] });
    } catch { setCancelError({ id, account: accountId }); }
    finally { busy.current = false; setBusyId(""); }
  }
  async function checkStatus() {
    const result = await query.refetch();
    if (result.isSuccess && !result.data?.find(order => order.id === errorId)?.syncError) setCancelError(null);
  }
  const selected = orders.find(order => order.id === detailsId);
  const initialLoading = !!accountId && ((!query.data && query.isPending) || (mode === "open" && !marketQuery.data && marketQuery.isPending));
  const showTable = !!accountId && (initialLoading || orders.length > 0 || pendingMarkets.length > 0);
  return <section aria-label={title} className={ordersSectionClass}>
    {!accountId ? <ActivityEmpty className="-mx-4">Connect a passkey to view your orders.</ActivityEmpty> : !showTable && (unavailable ? <ActivityRecovery onRetry={refreshOrders} retrying={fetching}>Couldn’t load orders</ActivityRecovery> : <ActivityEmpty className="-mx-4">{mode === "open" ? "No open orders." : "No orders yet."}</ActivityEmpty>)}
    {showTable && <Table aria-label={title} loading={initialLoading && !orders.length && !pendingMarkets.length} loadingLabel="Loading orders">
      <TableBody>
        {initialLoading && !orders.length && !pendingMarkets.length && <TableSkeletonRows columns={8} />}
        {pendingMarkets.map(trade => {
          const market = trade.review.pair ?? DEFAULT_PAIR;
          const status = marketStatus(trade);
          const uncertain = status !== "Processing";
          return <TableRow key={`market:${trade.id}`} tabIndex={0} aria-label={`View market ${trade.review.side} ${displaySymbol(market.base)} order details`} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]" onClick={() => setMarketDetailsId(trade.id)} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); setMarketDetailsId(trade.id); } }}>
            <TableCell><ActivityTime value={trade.createdAt} /></TableCell>
            <TableCell>{displaySymbol(market.base)}/{market.quote.symbol}</TableCell>
            <TableCell>{trade.review.side === "buy" ? "Buy" : "Sell"}</TableCell>
            <TableCell className="text-right"><FormattedNumber value={trade.review.quantity} symbol={displaySymbol(market.base)} exactTooltip /></TableCell>
            <TableCell className="text-right text-muted-foreground">Market</TableCell>
            <TableCell className="text-right"><FormattedNumber value={trade.review.side === "buy" ? trade.review.principal : trade.review.estimatedOutput} symbol={market.quote.symbol} exactTooltip />{trade.review.side === "sell" && <span className="sr-only"> estimated</span>}</TableCell>
            <TableCell><span role="status" className={`inline-flex items-center gap-2 ${uncertain ? "text-muted-foreground" : ""}`}>{uncertain ? <AlertCircle className="size-4" aria-hidden="true" /> : <LoaderCircle className="size-4" aria-hidden="true" />}{status}</span></TableCell>
            <TableCell>{uncertain && <Button size="sm" variant="outline" disabled={marketQuery.isFetching} onClick={event => { event.stopPropagation(); void marketQuery.refetch(); }}>Check status</Button>}</TableCell>
          </TableRow>;
        })}
        {orders.map(order => {
          const market = order.preview.pair ?? DEFAULT_PAIR;
          const canCancel = order.state === 'created' && !!order.provider && ['AWAITING_DEPOSIT', 'OPEN', 'PARTIALLY_FILLED'].includes(order.provider.fillStatus) && !order.cancelPending && !order.syncError && errorId !== order.id;
          const unavailable = !!order.syncError;
          const unconfirmed = order.state === "unknown" || (order.fundingState === "unknown" && (!order.provider || order.provider.depositedAmount === "0"));
          const warning = errorId === order.id ? "Cancellation unconfirmed" : unavailable ? "Status unavailable" : null;
          const settlement = warning ? null : orderSettlement(order);
          const side = order.preview.side;
          const sizes = limitSizes(order);
          return <TableRow key={order.id} tabIndex={0} aria-label={`View ${side} ${displaySymbol(market.base)} order details`} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]" onClick={event => { if (!(event.target as HTMLElement).closest("button,a")) setDetailsId(order.id); }} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); setDetailsId(order.id); } }}>
              <TableCell><ActivityTime value={order.createdAt} /></TableCell>
              <TableCell>{displaySymbol(market.base)}/{market.quote.symbol}</TableCell>
              <TableCell>{side === 'buy' ? 'Buy' : 'Sell'}</TableCell>
              <TableCell className="text-right" title={`${order.preview.quantity} ${displaySymbol(market.base)}`}><FormattedNumber value={sizes.remaining} exactTooltip /> / <FormattedNumber value={order.preview.quantity} symbol={displaySymbol(market.base)} exactTooltip /></TableCell>
              <TableCell className="text-right" title={`${order.preview.price} ${market.quote.symbol}`}><FormattedNumber value={order.preview.price} format="price" symbol={market.quote.symbol} exactTooltip /></TableCell>
              <TableCell className="text-right"><FormattedNumber value={new D(order.preview.quantity).mul(order.preview.price).toFixed()} symbol={market.quote.symbol} exactTooltip /></TableCell>
              <TableCell><span className="inline-flex items-center gap-2">
                {!warning && (busyId === order.id || order.cancelPending || order.provider?.fillStatus === 'PENDING_CANCEL') ? <LoaderCircle  /> : null}
                {warning ? <span role="status" className="flex items-center gap-2 text-destructive"><AlertCircle aria-hidden="true" />{warning}</span> : <>{orderStatus(order, busyId === order.id)}</>}
              </span>{settlement && <p className={order.syncError || order.provider?.payoutStatus === 'FAILED' ? 'text-destructive' : 'text-muted-foreground'}>{settlement}</p>}</TableCell>
              <TableCell className="text-right">{warning || unconfirmed ? <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void checkStatus()}>{query.isFetching && <LoaderCircle  />}{query.isFetching ? 'Checking…' : 'Check status'}</Button> : canCancel && busyId !== order.id && <Button size="icon-sm" variant="ghost" aria-label={`Cancel ${side} order at ${order.preview.price} ${market.quote.symbol}`} title="Cancel order" disabled={!!busyId} onClick={() => void cancelOrder(order.id)}><X /></Button>}</TableCell>
            </TableRow>;
        })}
      </TableBody>
    </Table>}
    {accountId && unavailable && (orders.length > 0 || pendingMarkets.length > 0) && <ActivityRefreshStatus lastUpdatedAt={oldestUpdate(query.dataUpdatedAt, ...(mode === "open" ? [marketQuery.dataUpdatedAt] : []))} onRetry={refreshOrders} retrying={fetching} />}
    <DialogDrawer open={!!selectedMarket && !!accountId} onOpenChange={open => { if (!open) setMarketDetailsId(""); }}><DialogDrawerContent>
      {selectedMarket && <MarketOrderDetail trade={selectedMarket} status={marketStatus(selectedMarket)} uncertain={marketStatus(selectedMarket) !== "Processing"} fetching={marketQuery.isFetching} onCheckStatus={() => void marketQuery.refetch()} />}
    </DialogDrawerContent></DialogDrawer>
    <DialogDrawer open={!!selected && !!accountId} onOpenChange={open => { if (!open) setDetailsId(''); }}><DialogDrawerContent>
      {selected && <LimitOrderDetail order={selected} status={errorId === selected.id ? "Cancellation unconfirmed" : selected.syncError ? "Status unavailable" : orderStatus(selected, busyId === selected.id)}
        recoveryMessage={errorId === selected.id ? "Check the latest order status before trying to cancel again." : undefined} fetching={query.isFetching} onCheckStatus={() => void checkStatus()} />}
    </DialogDrawerContent></DialogDrawer>
  </section>;
}
