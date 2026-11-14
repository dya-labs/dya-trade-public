import type { useTradingWallet } from "@dya/wallet-ui/hooks/use-trading-wallet";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCatalogQuery } from "@dya/wallet-ui/hooks/use-wallet-queries";
import { useBalanceQuery } from "./use-live-balances";
import { useOrders } from "./use-activity";
import { ConfidentialAccessRequired } from "@/lib/near/domain/confidential-access-error";
import { getTokenMarkets } from "@/lib/near/http/catalog-client";
import { TOKEN_MARKETS_FRESH_MS } from "@/lib/near/domain/token-icons";
import { portfolioHoldings } from "./portfolio-model";

export type TradingWalletData = ReturnType<typeof useTradingWallet>;

export function usePortfolio(accountId: string | null, loading = false, trading?: TradingWalletData) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const balances = useBalanceQuery(trading ? null : accountId), orders = useOrders(trading ? null : accountId), catalog = useCatalogQuery(!!accountId);
  const markets = useQuery({ queryKey: ["near", "token-markets"], queryFn: ({ signal }) => getTokenMarkets(signal), enabled: !!accountId, staleTime: 300_000, refetchInterval: 300_000 });
  const balance = trading?.balance ?? balances;
  const locked = balance.error instanceof ConfidentialAccessRequired;
  const waiting = loading || (!!accountId && (balance.isPending || (!trading && orders.isPending) || catalog.isPending || markets.isPending));
  const failed = !!(balance.error || (!trading && orders.error) || catalog.error || (markets.error && !markets.data));
  const pricesDelayed = !!markets.data && (!!markets.error || now - markets.data.updatedAt > TOKEN_MARKETS_FRESH_MS);
  const model = portfolioHoldings(locked || !accountId ? [] : (trading ? trading.assets : balances.data?.assets) ?? [], locked || !accountId ? [] : trading ? [] : orders.data ?? [], catalog.data?.assets ?? [], markets.data?.assets ?? {});
  const partial = model.unsettled > 0 || model.unpriced > 0 || !!trading?.unknown.length;
  const noValuation = model.rows.length > 0 && model.rows.every(row => row.value === null);
  const unavailable = !balance.data || (!trading && !orders.data);
  const successfulUpdates = [balance.dataUpdatedAt, orders.dataUpdatedAt, catalog.dataUpdatedAt, markets.dataUpdatedAt].filter(time => Number.isFinite(time) && time > 0);
  const lastUpdatedAt = successfulUpdates.length ? Math.min(...successfulUpdates) : undefined;
  const refreshing = !!(balance.isFetching || orders.isFetching || catalog.isFetching || markets.isFetching);
  function retry() { void balance.refetch(); if (!trading) void orders.refetch(); void catalog.refetch(); void markets.refetch(); }
  return { locked, waiting, failed, pricesDelayed, model, partial, noValuation, unavailable, retry, lastUpdatedAt, refreshing };
}
