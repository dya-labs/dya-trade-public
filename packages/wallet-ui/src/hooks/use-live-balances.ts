"use client";
import { ConfidentialAccessRequired } from "../lib/near/domain/confidential-access-error";
import { getAllBalances } from "../lib/near/http/account-client";
import { walletPollingInterval, withWalletRateLimit } from "./query-policy";
import { useQuery } from "@tanstack/react-query";

export const balanceQueryKey = (accountId: string | null) => ["near", "account", accountId, "balances", "confidential", "all"] as const;
export function useBalanceQuery(accountId: string | null) {
  const query = useQuery({
    queryKey: balanceQueryKey(accountId),
    enabled: !!accountId,
    queryFn: ({ signal, client, queryKey }) => {
      return withWalletRateLimit(client.getQueryCache().find({ queryKey, exact: true })!, () => getAllBalances(signal));
    },
    staleTime: 30000,
    // Own trades, fills, deposits, withdrawals and funding invalidate balances; the poll only catches outside transfers.
    refetchInterval: query => walletPollingInterval(query, 120_000),
    retry: false,
    refetchOnWindowFocus: true,
  });
  return { ...query, data: query.error instanceof ConfidentialAccessRequired ? undefined : query.data };
}
export function useLiveBalances(accountId: string | null) {
  const query = useBalanceQuery(accountId);
  return {
    accessRequired: !!accountId && query.error instanceof ConfidentialAccessRequired,
    balances: accountId && !(query.error instanceof ConfidentialAccessRequired) ? query.data ?? null : null,
    balanceError: query.error ? query.data ? "Updates delayed · showing last known balances." : query.error instanceof Error ? query.error.message : "Unlock confidential balances in Wallet settings." : "",
    loading: !!accountId && query.isPending,
    refresh: () => query.refetch(),
  };
}
