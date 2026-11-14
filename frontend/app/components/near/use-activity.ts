"use client";
import { getMarketTradeStatus, getMarketTrades, getOrderStatus, getOrders } from "@/lib/near/http/trading-client";
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StoredOrder, Trade } from "@/lib/near/http/schemas/trading";

export type { Trade } from "@/lib/near/http/schemas/trading";
export type { DepositItem, WithdrawalItem } from "@/lib/near/http/schemas/transfers";
const TERMINAL = new Set(["FILLED", "CANCELED", "EXPIRED"]);
// Poll every 5 s only while something is still settling. Otherwise a slow poll, focus refetches and
// QueryProvider's cross-tab channel keep the lists current; this tab's own actions invalidate them directly.
const SETTLING_MS = 5_000, IDLE_MS = 60_000;
const options = { staleTime: 2_000, retry: 1 } as const;
const orderBalanceState = (order: StoredOrder) => JSON.stringify([
  order.fundingState, order.provider?.depositedAmount, order.provider?.fillStatus,
  order.provider?.payoutStatus, order.provider?.payoutFinal,
  order.provider?.partialFills.map(fill => [fill.id, fill.amountIn, fill.amountOut]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
]);

export function useOrders(accountId: string | null) {
  const backfill = useRef(new Map<string, number>());
  const sync = (order: StoredOrder) => {
    const terminal = !!order.provider?.payoutFinal && TERMINAL.has(order.provider.fillStatus);
    const missingHash = terminal && !order.provider?.payoutTxHashes?.length && !order.provider?.refundTxHash && (backfill.current.get(`${accountId}:${order.id}`) ?? 0) < 3;
    return { missingHash, settling: !((!order.provider && !["creating", "unknown"].includes(order.state)) || (order.provider && order.state !== "created") || (terminal && !missingHash)) };
  };
  return useQuery<StoredOrder[]>({ queryKey: ["near", "account", accountId, "orders", "confidential"], enabled: !!accountId, ...options,
    refetchInterval: query => query.state.data?.some(order => sync(order).settling) ? SETTLING_MS : IDLE_MS,
    queryFn: async ({ signal, client }) => {
      const previous = client.getQueryData<StoredOrder[]>(["near", "account", accountId, "orders", "confidential"]);
      const listed = await getOrders(signal);
      const orders = await Promise.all(listed.orders.map(async order => {
        const { missingHash, settling } = sync(order);
        if (!settling) return order;
        try { const refreshed = (await getOrderStatus(order.id, signal)).order; if (missingHash) backfill.current.set(`${accountId}:${order.id}`, (backfill.current.get(`${accountId}:${order.id}`) ?? 0) + 1); return refreshed; }
        catch { return { ...order, syncError: "Unable to refresh order status." }; }
      }));
      // Order funding and fills settle after submission; refresh balances when polling sees them.
      if (orders.some((order, i) => {
        const old = previous?.find(item => item.id === order.id);
        return orderBalanceState(order) !== orderBalanceState(listed.orders[i]) ||
          (!!previous && (!old || orderBalanceState(order) !== orderBalanceState(old)));
      }))
        void client.invalidateQueries({ queryKey: ["near", "account", accountId, "balances"] });
      return orders;
    },
  });
}
export function useMarketTrades(accountId: string | null) {
  const backfill = useRef(new Map<string, number>());
  const sync = (trade: Trade) => {
    const historical = ["settled", "failed"].includes(trade.state);
    return { historical, settling: !(historical && ((trade.nearTxHashes !== undefined && (trade.state !== "settled" || !!trade.execution)) || (backfill.current.get(`${accountId}:${trade.id}`) ?? 0) >= 3)) };
  };
  return useQuery<(Trade & { syncError: boolean })[]>({ queryKey: ["near", "account", accountId, "trades", "confidential"], enabled: !!accountId, ...options,
    refetchInterval: query => query.state.data?.some(trade => sync(trade).settling) ? SETTLING_MS : IDLE_MS,
    queryFn: async ({ signal, client }) => {
      const previous = client.getQueryData<Trade[]>(["near", "account", accountId, "trades", "confidential"]);
      const listed = await getMarketTrades(signal);
      const trades = await Promise.all(listed.trades.map(async trade => {
        const { historical, settling } = sync(trade);
        if (!settling) return { ...trade, syncError: false };
        try { const refreshed = (await getMarketTradeStatus(trade.id, signal)).trade; if (historical) backfill.current.set(`${accountId}:${trade.id}`, (backfill.current.get(`${accountId}:${trade.id}`) ?? 0) + 1); return { ...refreshed, syncError: false }; }
        catch { return { ...trade, syncError: true }; }
      }));
      if (trades.some((trade, i) => ["settled", "failed"].includes(trade.state) &&
        (trade.state !== listed.trades[i].state ||
          (!!previous && previous.find(item => item.id === trade.id)?.state !== trade.state))))
        void client.invalidateQueries({ queryKey: ["near", "account", accountId, "balances"] });
      return trades;
    },
  });
}
export { useTransfers } from "@dya/wallet-ui/hooks/use-transfers";
