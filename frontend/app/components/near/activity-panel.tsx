"use client";
import { useCatalogQuery } from "@dya/wallet-ui/hooks/use-wallet-queries";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { LoaderCircle, X } from "@dya/ui/icons";
import { OpenOrdersTable, ordersSectionClass } from "./open-orders-table";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@dya/ui/components/button";
import { cancelTradingLimitOrder, readTradingOpenOrders } from "@dya/wallet-ui/lib/near/http/trading-wallet-client";
import type { UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@dya/ui/components/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@dya/ui/components/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@dya/ui/components/select";
import type { SelectedPair } from "@/lib/near/domain/catalog";
import type { TrackedDepositQuote } from "@/lib/near/http/schemas/transfers";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { useOrders, useMarketTrades } from "./use-activity";
import { actionableLimit, pendingMarket, inMarket } from "./activity-model";
import { Orders } from "./orders";
import { OrderHistory } from "./order-history";
import { TradeHistory } from "./trade-history";
import { TransferActivity } from "./transfer-activity";
import { IntentsTrades } from "./intents-trades";

import { WalletActivity } from "@dya/wallet-ui/components/wallet-activity";
import { ActivityEmpty, ActivityRecovery } from "./activity-state";
import { ActivityTable } from "./activity-table";
import { ActivityTime } from "./activity-time";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dya/ui/components/table";
import type { TradingWalletData } from "./use-portfolio";
import { Balances } from "./balances";

function pendingSwap(status: string) {
  return ["Awaiting approval", "Approved", "Awaiting deposit", "Processing", "Needs review"].includes(status);
}

function TradingSwapHistory({ activity }: { activity: TradingWalletData["activity"] }) {
  const rows = activity.items.filter(item => item.type === "swap" && !pendingSwap(item.status));
  if (!rows.length) return <ActivityEmpty>{activity.isPending ? "Loading swaps…" : activity.isError ? "Couldn’t load swaps." : "No swap history yet."}</ActivityEmpty>;
  return <ActivityTable aria-label="Swap history" columnWidths={[176, 120, 160]}>
    <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
    <TableBody>{rows.map(item => <TableRow key={item.id}><TableCell><ActivityTime value={item.time} /></TableCell><TableCell>{item.title}</TableCell><TableCell>{item.status}</TableCell></TableRow>)}</TableBody>
  </ActivityTable>;
}

type OpenLimitOrders = UseQueryResult<Awaited<ReturnType<typeof readTradingOpenOrders>>>;

function TradingOpenOrders({ walletId, orders, pair, activity }: { walletId: string; orders: OpenLimitOrders; pair?: SelectedPair; activity: TradingWalletData["activity"] }) {
  const catalog = useCatalogQuery();
  const cancel = useMutation({
    mutationFn: (orderId: string) => cancelTradingLimitOrder(walletId, orderId),
    onSettled: () => { void orders.refetch(); },
  });
  const rows = orders.data?.orders.filter(order => !pair || (order.base_asset === pair.base.assetId && order.quote_asset === pair.quote.assetId)) ?? [];
  const swaps = activity.items.filter(item => item.type === "swap" && pendingSwap(item.status));
  const loading = orders.isPending || activity.isPending;
  const unavailable = orders.isError || activity.isError;
  function retry() { void orders.refetch(); void activity.refetch(); }
  return <section aria-label="Open orders" className={ordersSectionClass}>
    {rows.length || swaps.length ? <OpenOrdersTable aria-label="Open orders">
      <TableBody>
        {swaps.map(item => <TableRow key={`swap:${item.id}`}>
          <TableCell><ActivityTime value={item.time} /></TableCell>
          <TableCell>—</TableCell>
          <TableCell>—</TableCell>
          <TableCell className="text-right">—</TableCell>
          <TableCell className="text-right text-muted-foreground">Market</TableCell>
          <TableCell className="text-right">—</TableCell>
          <TableCell><span className="inline-flex items-center gap-2"><LoaderCircle aria-hidden="true" />{item.status}</span></TableCell>
          <TableCell />
        </TableRow>)}
        {rows.map(order => {
          const base = catalog.data?.assets.find(asset => asset.assetId === order.base_asset);
          const quote = catalog.data?.assets.find(asset => asset.assetId === order.quote_asset);
          const status = cancel.data?.order_id === order.order_id ? cancel.data.fill_status : order.fill_status;
          const cancelling = cancel.isPending && cancel.variables === order.order_id;
          return <TableRow key={order.order_id}>
            <TableCell>—</TableCell>
            <TableCell>{base && quote ? `${displaySymbol(base)}/${displaySymbol(quote)}` : "—"}</TableCell>
            <TableCell>{order.side === "buy" ? "Buy" : "Sell"}</TableCell>
            <TableCell className="text-right">—</TableCell>
            <TableCell className="text-right"><FormattedNumber value={order.price} symbol={quote && displaySymbol(quote)} format="price" exactTooltip /></TableCell>
            <TableCell className="text-right">—</TableCell>
            <TableCell><span className="inline-flex items-center gap-2 capitalize">
              {(cancelling || status.toLowerCase() === "pending_cancel") && <LoaderCircle aria-hidden="true" />}
              {cancelling ? "Cancelling…" : status.replaceAll("_", " ")}
            </span></TableCell>
            <TableCell className="text-right">{["open", "partially_filled", "awaiting_deposit"].includes(status.toLowerCase()) && !order.is_payout_status_final && <Button
              variant="ghost" size="icon-sm" disabled={cancel.isPending || cancel.data?.order_id === order.order_id}
              aria-label={`Cancel ${order.side} order at ${order.price}`}
              title="Cancel order"
              onClick={() => cancel.mutate(order.order_id)}
            ><X /></Button>}</TableCell>
          </TableRow>;
        })}</TableBody>
      </OpenOrdersTable> : !unavailable && <ActivityEmpty className="-mx-4">{loading ? "Loading orders…" : "No open orders."}</ActivityEmpty>}
    {unavailable && <ActivityRecovery onRetry={retry} retrying={orders.isFetching || activity.isFetching}>Couldn’t load all open orders</ActivityRecovery>}
    {cancel.isError && <p role="alert" className="px-4 py-2 text-sm text-destructive">{cancel.error.message}</p>}
    {cancel.data && <p role="status" className="px-4 py-2 text-sm">{cancel.data.is_payout_status_final ? `Final order status: ${cancel.data.fill_status.replaceAll("_", " ")}` : "Waiting for OutLayer to confirm final order status."}</p>}
  </section>;
}

export type ActivityTab = "balances" | "orders" | "order-history" | "my-trades" | "transfers" | "intents-trades";
export function ActivityPanel({ accountId, pair, marketId, allMarketsOnly = false, showBalanceWarning = true, value, onChange, className, openTransfers, openDeposit, trading, tradingLimits }: {
  accountId: string | null; pair: SelectedPair; marketId?: string; allMarketsOnly?: boolean; showBalanceWarning?: boolean; value: ActivityTab; onChange: (value: ActivityTab) => void;
  trading?: TradingWalletData; tradingLimits?: { walletId: string; orders: OpenLimitOrders }; className?: string; openTransfers: () => void; openDeposit: (quote: TrackedDepositQuote) => void;
}) {
  const [scope, setScope] = useState("all");
  const selectedPair = !allMarketsOnly && scope === "current" ? pair : undefined;
  const orders = useOrders(trading ? null : accountId);
  const trades = useMarketTrades(trading ? null : accountId);
  const count = orders.data || trades.data ? (orders.data ?? []).filter(order => actionableLimit(order) && inMarket(order.preview.pair, selectedPair)).length + (trades.data ?? []).filter(trade => pendingMarket(trade, selectedPair)).length : undefined;
  const personalTrading = ["orders", "order-history", "my-trades"].includes(value);
  return <Tabs value={value} onValueChange={next => onChange(next as ActivityTab)} className={`@container/activity ${className ?? ""}`}>
    <div className="flex min-h-[45px] shrink-0 flex-wrap items-stretch gap-x-4 border-(--panel-border) px-2 @min-[760px]/activity:border-b">
    <TabsList variant="line" aria-label="Trade activity" className="min-h-[45px] w-full shrink-0 self-stretch justify-start gap-0 @min-[760px]/activity:gap-5 group-data-horizontal/tabs:h-auto overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden border-b border-(--panel-border) px-0 @min-[760px]/activity:mx-0 @min-[760px]/activity:min-h-11 @min-[760px]/activity:border-b-0 @min-[760px]/activity:px-0 @min-[760px]/activity:w-auto @min-[760px]/activity:flex-1 @min-[760px]/activity:min-w-0 [&>.tab-sliding-indicator]:bottom-0">
      <TabsTrigger value="balances" className="flex-none px-4 @min-[760px]/activity:px-0">Balances</TabsTrigger>
      <TabsTrigger value="orders" className="flex-none px-4 @min-[760px]/activity:px-0" aria-label={count ? `Open orders (${count})` : "Open orders"}>Open orders{count !== undefined && count > 0 && <Badge variant="count" aria-hidden="true">{count}</Badge>}</TabsTrigger>
      <TabsTrigger value="my-trades" className="flex-none px-4 @min-[760px]/activity:px-0">Trade history</TabsTrigger>
      <TabsTrigger value="order-history" className="flex-none px-4 @min-[760px]/activity:px-0">Order history</TabsTrigger>
      <TabsTrigger value="transfers" className="flex-none px-4 @min-[760px]/activity:px-0">Transfers</TabsTrigger>
      {marketId && <TabsTrigger value="intents-trades" className="flex-none px-4 @min-[760px]/activity:px-0">Market trades</TabsTrigger>}
    </TabsList>
    <div className="ml-auto flex min-h-11 shrink-0 items-center py-1 text-xs text-muted-foreground">
      {personalTrading && !allMarketsOnly ? <Select value={scope} onValueChange={next => { if (next) setScope(next); }}><SelectTrigger aria-label="Market filter" size="xs" className="w-auto gap-2 border-transparent bg-transparent pl-2 text-xs shadow-none dark:bg-transparent dark:hover:bg-hover"><SelectValue>{scope === "all" ? "All markets" : `Current market (${displaySymbol(pair.base)}/${pair.quote.symbol})`}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All markets</SelectItem><SelectItem value="current">Current market ({displaySymbol(pair.base)}/{pair.quote.symbol})</SelectItem></SelectContent></Select> : <span>{personalTrading ? "All markets" : value === "balances" ? "All assets" : value === "transfers" ? "All assets and networks" : "Public NEAR Intents swaps · excludes confidential trades"}</span>}
    </div>
    </div>
    <TabsContent value="balances" className="dya-scrollbar min-h-0 overflow-y-auto"><Balances accountId={accountId} showDataWarning={showBalanceWarning} trading={trading} /></TabsContent>
    <TabsContent value="orders" className="dya-scrollbar min-h-0 overflow-y-auto">{trading && accountId ? tradingLimits && <TradingOpenOrders {...tradingLimits} pair={selectedPair} activity={trading.activity} /> : <Orders accountId={accountId} mode="open" selectedPair={selectedPair} />}</TabsContent>
    <TabsContent value="my-trades" className="dya-scrollbar min-h-0 overflow-y-auto">{trading && accountId ? <TradingSwapHistory activity={trading.activity} /> : <TradeHistory accountId={accountId} selectedPair={selectedPair} />}</TabsContent>
    <TabsContent value="order-history" className="dya-scrollbar min-h-0 overflow-y-auto">{trading && accountId ? <ActivityEmpty>Order history unavailable for this wallet.</ActivityEmpty> : <OrderHistory accountId={accountId} selectedPair={selectedPair} />}</TabsContent>
    <TabsContent value="transfers" className="dya-scrollbar min-h-0 overflow-y-auto">{trading && accountId ? <div className="px-4 py-3"><WalletActivity accountId={accountId} source={trading.activity} hideHeading onReceive={openTransfers} /></div> : <TransferActivity accountId={accountId} openTransfers={openTransfers} openDeposit={openDeposit} />}</TabsContent>
    {marketId && <TabsContent value="intents-trades" className="dya-scrollbar min-h-0 overflow-y-auto"><IntentsTrades marketId={marketId} base={displaySymbol(pair.base)} baseAsset={pair.base} /></TabsContent>}
  </Tabs>;
}
