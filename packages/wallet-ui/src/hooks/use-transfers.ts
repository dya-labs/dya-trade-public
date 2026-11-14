"use client";
import { useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDepositStatus, getDeposits, getWithdrawalStatus, getWithdrawals } from "../lib/near/http/transfers-client";
import { RateLimitError } from "../lib/near/domain/rate-limit";
import { walletPollingInterval } from "./query-policy";
type TransferHistory = { withdrawals: Awaited<ReturnType<typeof getWithdrawals>>["withdrawals"]; deposits: Awaited<ReturnType<typeof getDeposits>>["deposits"]; internalReceipts: Awaited<ReturnType<typeof getDeposits>>["internalReceipts"]; unavailableIds: string[] };
export function useTransfers(accountId: string | null) {
  const backfill = useRef(new Map<string, number>());
  return useQuery<TransferHistory>({ queryKey: ["near", "account", accountId, "transfers", "confidential"], enabled: !!accountId, staleTime: 2000, retry: false, refetchInterval: query => walletPollingInterval(query, query.state.data?.withdrawals.some(w => ["signing", "submitted", "unknown"].includes(w.state)) || query.state.data?.deposits.some(d => !["SUCCESS", "REFUNDED", "FAILED"].includes(d.status)) ? 5000 : 30000),
    queryFn: async ({ signal, client, queryKey }) => {
      const error = client.getQueryState(queryKey)?.error;
      if (error instanceof RateLimitError && error.retryAt > Date.now()) throw error;
      const previous = client.getQueryData<TransferHistory>(queryKey);
      const [listed, deposits] = await Promise.all([getWithdrawals(signal), getDeposits(signal)]);
      const toRefreshWithdrawals = listed.withdrawals.filter(w => ["signing", "submitted", "unknown"].includes(w.state) || (["settled", "failed"].includes(w.state) && w.destinationChainTxHashes === undefined && (backfill.current.get(`${accountId}:w:${w.id}`) ?? 0) < 3));
      const toRefreshDeposits = deposits.deposits.filter(d => (!["SUCCESS", "REFUNDED", "FAILED"].includes(d.status) && Date.now() - d.createdAt < 7 * 86400000) || (["SUCCESS", "REFUNDED", "FAILED"].includes(d.status) && d.originChainTxHashes === undefined && (backfill.current.get(`${accountId}:d:${d.id}`) ?? 0) < 3));
      const unavailableIds: string[] = [];
      await Promise.all([...toRefreshWithdrawals.map(w => getWithdrawalStatus(w.id, signal).then(() => { if (["settled", "failed"].includes(w.state)) backfill.current.set(`${accountId}:w:${w.id}`, (backfill.current.get(`${accountId}:w:${w.id}`) ?? 0) + 1); }).catch(error => { if (error instanceof RateLimitError) throw error; unavailableIds.push(w.id); })), ...toRefreshDeposits.map(d => getDepositStatus(d.id, signal).then(() => { if (["SUCCESS", "REFUNDED", "FAILED"].includes(d.status)) backfill.current.set(`${accountId}:d:${d.id}`, (backfill.current.get(`${accountId}:d:${d.id}`) ?? 0) + 1); }).catch(error => { if (error instanceof RateLimitError) throw error; unavailableIds.push(d.id); }))]);
      const [updated, updatedDeposits] = await Promise.all([toRefreshWithdrawals.length ? getWithdrawals(signal) : listed, toRefreshDeposits.length ? getDeposits(signal) : deposits]);
      // The first status poll can settle before history is cached; newly listed
      // terminal transfers also need a refresh even without a prior matching ID.
      const observedWithdrawals = previous?.withdrawals ?? listed.withdrawals;
      const observedDeposits = previous?.deposits ?? deposits.deposits;
      const receivedInternalTransfer = !!previous && updatedDeposits.internalReceipts?.some(receipt =>
        !previous.internalReceipts?.some(old => old.id === receipt.id));
      if (receivedInternalTransfer || updated.withdrawals.some(w => ["settled", "failed"].includes(w.state) && observedWithdrawals.find(old => old.id === w.id)?.state !== w.state) || updatedDeposits.deposits.some(d => ["SUCCESS", "REFUNDED", "FAILED"].includes(d.status) && observedDeposits.find(old => old.id === d.id)?.status !== d.status)) {
        void client.invalidateQueries({ queryKey: ["near", "account", accountId, "balances"] });
      }
      return { withdrawals: updated.withdrawals, deposits: updatedDeposits.deposits, internalReceipts: updatedDeposits.internalReceipts, unavailableIds };
    },
  });
}

export function useTransferStatusMutation(accountId: string) {
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ id, kind }: { id: string; kind: "send" | "receive" }) => {
      if (kind === "send") await getWithdrawalStatus(id);
      else await getDepositStatus(id);
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["near", "account", accountId] }); },
  });
}
