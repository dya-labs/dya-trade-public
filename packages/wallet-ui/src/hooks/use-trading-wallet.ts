import { useState } from "react";
import { useQuery } from '@tanstack/react-query';
import { D } from '@dya/wallet-contracts/src/domain/decimal';
import type { CatalogAsset } from '@dya/wallet-contracts/src/domain/catalog';
import { readTradingActivity, readTradingTokenBalances } from '../lib/near/http/trading-wallet-client';

const activityTitles: Record<string, string> = { deposit: 'Deposit', withdraw: 'Withdrawal', transfer: 'Transfer', swap: 'Swap' };
const activityStatuses: Record<string, string> = {
 success: 'Completed', failed: 'Failed', refunded: 'Refunded', rejected: 'Declined',
 pending_approval: 'Awaiting approval', approved: 'Approved', pending_deposit: 'Awaiting deposit', processing: 'Processing', needs_review: 'Needs review',
};

export function useTradingWallet(id: string | undefined, catalog: CatalogAsset[]) {
 const [submitted, setSubmitted] = useState<Record<string, { request_id: string; type: string; status: string; created_at: string }[]>>({});
 function trackSwap(requestId: string, status = "processing") {
  if (!id) return;
  const request = { request_id: requestId, type: "swap", status, created_at: new Date().toISOString() };
  setSubmitted(current => ({ ...current, [id]: [request, ...(current[id] ?? []).filter(item => item.request_id !== requestId)].slice(0, 20) }));
 }
 const balance = useQuery({
  queryKey: ['id', 'trading-token-balances', id],
  queryFn: () => readTradingTokenBalances(id!),
  enabled: !!id,
  refetchInterval: 30_000,
 });
 const activity = useQuery({
  queryKey: ['id', 'trading-activity', id],
  queryFn: () => readTradingActivity(id!),
  enabled: !!id,
  refetchInterval: 30_000,
 });
 const assets = balance.data?.balances.flatMap(asset => {
  const metadata = catalog.find(token => token.assetId === asset.token);
  return metadata ? [{ ...metadata, raw: asset.balance, amount: new D(asset.balance).div(new D(10).pow(metadata.decimals)).toFixed() }] : [];
 });
 const unknown = balance.data?.balances.filter(asset => asset.balance !== '0' && !catalog.some(token => token.assetId === asset.token)) ?? [];
 const reported = activity.data?.requests ?? [];
 const reportedIds = new Set(reported.map(item => item.request_id));
 const requests = [...(submitted[id ?? ""] ?? []).filter(item => !reportedIds.has(item.request_id)), ...reported];
 return { balance, assets, unknown, trackSwap, activity: {
  deposits: activity.data?.deposits,
  withdrawals: activity.data?.withdrawals,
  items: requests.map(item => ({
   id: item.request_id, type: item.type, title: activityTitles[item.type] ?? 'Wallet activity',
   status: activityStatuses[item.status] ?? 'Status unavailable',
   time: Date.parse(item.created_at), incoming: item.type === 'deposit',
  })),
  isPending: activity.isPending, isError: activity.isError, isFetching: activity.isFetching, refetch: activity.refetch,
 } };
}
