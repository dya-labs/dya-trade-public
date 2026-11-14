"use client";
import { TransferAddress } from "./transfer-address";
import { ActivityTransactions } from "./activity-transactions";
import { ChainsPath } from "@dya/wallet-ui/components/near/chains-path";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { AlertCircle, LoaderCircle } from "@dya/ui/icons";
import { Button } from "@dya/ui/components/button";
import { ActivityDetailRow } from "@dya/ui/components/activity-detail";
import { TransferDetailSummary } from "./transfer-detail-summary";
import { DialogDrawer } from "@dya/ui/components/dialog-drawer";
import { ActivityDetailContent as DialogDrawerContent } from "@dya/ui/components/activity-detail";
import { TableRow, TableCell } from "@dya/ui/components/table";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getBridgeDeposits } from "@/lib/near/http/transfers-client";
import { useCatalogQuery } from "@dya/wallet-ui/hooks/use-wallet-queries";
import { D } from "@/lib/near/domain/decimal";
import { networkFor } from "@/lib/near/domain/bridge-networks";
import { networkName } from "@/lib/near/domain/deposit-assets";

export function useBridgeActivity(accountId: string | null) {
  const client = useQueryClient();

  const query = useQuery({ queryKey: ["near", "account", accountId, "bridge-deposits"], enabled: !!accountId, queryFn: ({ signal }) => getBridgeDeposits(signal), refetchInterval: 15000, retry: 1 });
  useEffect(() => { if (query.data) void client.invalidateQueries({ queryKey: ["near", "account", accountId, "balances"] }); }, [query.data, client, accountId]);
  return query;
}
export function BridgeActivity({ query, asRows = false }: { query: ReturnType<typeof useBridgeActivity>; asRows?: boolean }) {
  const catalog = useCatalogQuery();
  const [selected, setSelected] = useState<string | null>(null);
  const item = selected === null ? undefined : query.data?.deposits.find(d => `${d.chain}:${d.txHash}:${d.assetId}:${d.address}` === selected);
  const selectedAsset = catalog.data?.assets.find(asset => asset.assetId === item?.assetId);
  if (asRows) return <>{query.data?.deposits.map((d, i) => {
    const asset = catalog.data?.assets.find(a => a.assetId === d.assetId);
    const source = asset ? networkName(asset.blockchain) : networkName(networkFor(d.chain) ?? d.chain);
    return <TableRow key={`${d.chain}:${d.txHash}:${i}`} tabIndex={0} aria-label={`View direct deposit ${i + 1} details`} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setSelected(`${d.chain}:${d.txHash}:${d.assetId}:${d.address}`)} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); setSelected(`${d.chain}:${d.txHash}:${d.assetId}:${d.address}`); } }}>
      <TableCell><span title="The deposit provider does not supply a timestamp">-</span></TableCell><TableCell>Deposit</TableCell><TableCell><ChainsPath from={source} to="NEAR Intents" /></TableCell><TableCell className="text-right"><FormattedNumber value={new D(d.amount).div(new D(10).pow(d.decimals)).toFixed()} symbol={asset?.symbol ?? d.assetId} exactTooltip /></TableCell><TableCell>{query.error ? "Status unavailable" : d.status === "COMPLETED" ? "Completed" : d.status === "PENDING" ? "Processing" : "Failed"}</TableCell><TableCell>{query.error && <Button variant="outline" size="sm" disabled={query.isFetching} onClick={event => { event.stopPropagation(); void query.refetch(); }}>Check status</Button>}</TableCell>
    </TableRow>;
  })}<DialogDrawer open={!!item} onOpenChange={open => { if (!open) setSelected(null); }}><DialogDrawerContent>{item && <TransferDetailSummary direction="deposit" status={query.error ? "Status unavailable" : item.status === "COMPLETED" ? "Completed" : item.status === "PENDING" ? "Processing" : "Failed"} symbol={selectedAsset?.symbol ?? item.assetId} assetId={item.assetId} amount={new D(item.amount).div(new D(10).pow(item.decimals)).toFixed()}>
    <ActivityDetailRow label="Route"><ChainsPath from={selectedAsset ? networkName(selectedAsset.blockchain) : networkName(networkFor(item.chain) ?? item.chain)} to="NEAR Intents" labelSide="from" /></ActivityDetailRow>
    <ActivityDetailRow label="Time"><span className="text-muted-foreground">Unavailable</span></ActivityDetailRow>
    <TransferAddress label="From" network={networkFor(item.chain) ?? item.chain} />
    <TransferAddress label="Deposit address" address={item.address} network={networkFor(item.chain) ?? item.chain} />
    <ActivityTransactions hashes={item.txHash ? [item.txHash] : []} network={networkFor(item.chain) ?? item.chain} />
    {query.error && <Button className="w-full" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Check status</Button>}
  </TransferDetailSummary>}</DialogDrawerContent></DialogDrawer></>;
  if (!query.error && !query.data?.deposits.length) return null;
  return <div className="space-y-2"><h3>Direct deposits</h3>
    {query.error && <div className="flex flex-wrap items-center gap-2"><p role="alert" className="flex items-center gap-2 text-destructive"><AlertCircle className="size-4" />Deposit tracking unavailable</p><Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching && <LoaderCircle  />}{query.isFetching ? "Retrying…" : "Retry"}</Button></div>}
    {query.data?.deposits.map((d, i) => {
      const asset = catalog.data?.assets.find(a => a.assetId === d.assetId);
      return <div key={`${d.chain}:${d.txHash}:${i}`} className="flex items-center justify-between gap-3 border-b py-2"><span className="min-w-0 truncate">{asset ? networkName(asset.blockchain) : networkName(networkFor(d.chain) ?? d.chain)} · <FormattedNumber value={new D(d.amount).div(new D(10).pow(d.decimals)).toFixed()} format="exact" symbol={asset?.symbol ?? d.assetId} /></span><span>{query.error ? "Status unavailable" : d.status === "COMPLETED" ? "Credited" : d.status === "PENDING" ? "Processing" : "Bridge processing failed"}</span></div>;
    })}
  </div>;
}
