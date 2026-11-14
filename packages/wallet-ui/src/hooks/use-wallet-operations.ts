"use client";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { request } from "../lib/near/http/request";
import { trade } from "@dya/wallet-contracts/src/http/schemas/trading";
import { fundingBatch } from "@dya/wallet-contracts/src/http/schemas/funding-conversions";
import { DEFAULT_PAIR } from "@dya/wallet-contracts/src/domain/catalog";
import { RateLimitError } from "../lib/near/domain/rate-limit";
import { walletPollingInterval } from "./query-policy";

const active = (state: string) => ["submitting", "submitted", "unknown"].includes(state);
export function useWalletOperations(accountId: string, enabled = true) {
  const trades = useQuery<{ trades: z.infer<typeof trade>[]; statusUnavailable: boolean }>({ enabled, queryKey: ["near", "account", accountId, "wallet-market-activity"], retry: false, staleTime: 2000,
    refetchInterval: query => walletPollingInterval(query, query.state.data?.trades.some(t => active(t.state)) ? 5000 : 30000),
    queryFn: async ({ signal, client }) => {
      const data = await request("live/trades", z.object({ trades: z.array(trade) }), undefined, signal);
      const pending = data.trades.filter(t => active(t.state)).slice(0, 4);
      const results = await Promise.allSettled(pending.map(t => request("live/trades/status", z.object({ trade }), { id: t.id }, signal)));
      const rateLimited = results.find(r => r.status === "rejected" && r.reason instanceof RateLimitError);
      if (rateLimited?.status === "rejected") throw rateLimited.reason;
      const updated = results.flatMap(r => r.status === "fulfilled" ? [r.value.trade] : []);
      if (updated.some(t => t.state === "settled")) void client.invalidateQueries({ queryKey: ["near", "account", accountId, "balances"] });
      return { trades: data.trades.map(t => updated.find(u => u.id === t.id) ?? t), statusUnavailable: results.some(r => r.status === "rejected") };
    },
  });
  const funding = useQuery<{ operations: z.infer<typeof fundingBatch>[]; statusUnavailable: boolean }>({ enabled, queryKey: ["near", "account", accountId, "wallet-funding-activity"], retry: false, staleTime: 2000,
    refetchInterval: query => walletPollingInterval(query, query.state.data?.operations.some(b => b.legs.some(l => active(l.state))) ? 5000 : 30000),
    queryFn: async ({ signal, client }) => {
      const data = await request("funding/history", z.object({ operations: z.array(fundingBatch) }), {}, signal);
      const pending = data.operations.filter(b => b.legs.some(l => active(l.state))).slice(0, 4);
      const results = await Promise.allSettled(pending.map(b => request("funding/status", z.object({ operation: fundingBatch }), { id: b.id }, signal)));
      const rateLimited = results.find(r => r.status === "rejected" && r.reason instanceof RateLimitError);
      if (rateLimited?.status === "rejected") throw rateLimited.reason;
      const updated = results.flatMap(r => r.status === "fulfilled" ? [r.value.operation] : []);
      if (updated.some(b => b.legs.some(l => l.state === "settled"))) void client.invalidateQueries({ queryKey: ["near", "account", accountId, "balances"] });
      return { operations: data.operations.map(b => updated.find(u => u.id === b.id) ?? b), statusUnavailable: results.some(r => r.status === "rejected") };
    },
  });
  const items = [
    ...(trades.data?.trades ?? []).map(t => {
      const pair = t.review.pair ?? DEFAULT_PAIR;
      const buying = t.review.side === "buy";
      return { tradeSide: t.review.side, id: `trade:${t.id}`, time: t.createdAt, title: `${t.state === "settled" ? buying ? "Bought" : "Sold" : buying ? "Buy" : "Sell"} ${pair.base.symbol}`, asset: buying ? pair.base : pair.quote, amount: t.review.estimatedOutput, state: t.state, inputAmount: t.review.principal, inputSymbol: t.review.inputSymbol, minimum: t.review.minimumOutput, hashes: t.nearTxHashes ?? [] };
    }),
    ...(funding.data?.operations ?? []).flatMap(b => b.legs.filter(l => !["ready", "cancelled"].includes(l.state)).map(l => ({ tradeSide: undefined, id: `funding:${b.id}:${l.id}`, time: b.createdAt, title: "Transfer to trading", asset: l.review.pair?.quote ?? DEFAULT_PAIR.quote, amount: l.review.estimatedOutput, state: l.state, inputAmount: l.amount, inputSymbol: `${l.asset.symbol} · ${l.asset.blockchain}`, minimum: l.review.minimumOutput, hashes: [] as string[] }))),
  ];
  return { items, isPending: trades.isPending || funding.isPending, isError: trades.isError || funding.isError || !!trades.data?.statusUnavailable || !!funding.data?.statusUnavailable, isFetching: trades.isFetching || funding.isFetching, refetch: () => Promise.all([trades.refetch(), funding.refetch()]) };
}
