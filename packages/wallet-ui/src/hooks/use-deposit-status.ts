"use client";
import { useQuery } from "@tanstack/react-query";
import { getDepositStatus } from "../lib/near/http/transfers-client";

export function useDepositStatus(accountId: string, depositId?: string, readStatus?: (id: string, signal: AbortSignal) => Promise<{status: string; terminal: boolean}>) {
  return useQuery({
    queryKey: ["near", "account", accountId, "deposit-status", depositId],
    enabled: !!depositId,
    queryFn: async ({ signal }) => {
      if (readStatus) return readStatus(depositId!, signal);
      const result = await getDepositStatus(depositId!, signal);
      return { status: result.providerStatus, terminal: ["SUCCESS", "REFUNDED", "FAILED"].includes(result.providerStatus) };
    },
    refetchInterval: query => query.state.data?.terminal ? false : query.state.error ? 10_000 : 5_000,
    staleTime: 2_000,
    retry: 1,
  });
}
