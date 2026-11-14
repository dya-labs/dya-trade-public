"use client";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { getSession } from "../lib/near/http/account-client";
import { walletPollingInterval, withWalletRateLimit } from "./query-policy";
import { getCatalog } from "../lib/near/http/catalog-client";
/** Shared session transition cleanup used by Terminal and the ID dashboard. */
export async function fetchWalletSession({ signal, client }: { signal: AbortSignal; client: QueryClient }) {
  const previous = client.getQueryData<Awaited<ReturnType<typeof getSession>>>(["near", "session"]);
  const session = await getSession(signal);
  if (previous?.account && previous.account.id !== session.account?.id) {
    await client.cancelQueries({ queryKey: ["near", "account"] });
    client.removeQueries({ queryKey: ["near", "account"] });
  }
  return session;
}
export function useWalletSessionQuery() {
  return useQuery({ queryKey: ["near", "session"], queryFn: fetchWalletSession, staleTime: 30000, retry: false });
}

export function useCatalogQuery(enabled = true) {
  return useQuery({ queryKey: ["near", "catalog"], queryFn: ({ signal, client, queryKey }) => {
    return withWalletRateLimit(client.getQueryCache().find({ queryKey, exact: true })!, () => getCatalog(signal));
  }, enabled, staleTime: 300000, refetchInterval: query => walletPollingInterval(query, 300000), retry: false });
}
