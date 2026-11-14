"use client";
import { ActivityTable as Table } from "./activity-table";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { useState } from "react";
import { AlertCircle, ExternalLink, LoaderCircle } from "@dya/ui/icons";
import { TableSkeletonRows } from "@dya/ui/components/table-skeleton";
import { Button } from "@dya/ui/components/button";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { DialogDrawer, DialogDrawerContent, DialogDrawerHeader, DialogDrawerTitle } from "@dya/ui/components/dialog-drawer";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dya/ui/components/table";
import { useMarketTrades } from "./use-activity";
import { nearTransactionUrl } from "@/lib/near/domain/explorer";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { TERMINAL_PAIR } from "@/lib/terminal/config";

export function MarketTrades({ accountId }: { accountId: string | null }) {
  const query = useMarketTrades(accountId);
  const trades = query.data ?? [];
  const [detailsId, setDetailsId] = useState("");
  const selected = trades.find(trade => trade.id === detailsId);
  const loading = !!accountId && !query.data && query.isPending;
  function status(trade: typeof trades[number]) {
    return trade.syncError ? "Status unavailable" : trade.state === "settled" ? "Completed" : trade.state === "failed" ? "Failed" : trade.state === "unknown" ? "Unconfirmed" : "Processing";
  }
  const retry = (label: string) => <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching && <LoaderCircle  />}{query.isFetching ? "Checking…" : label}</Button>;
  return <section aria-label="My trades" className="space-y-4 px-4 [&>[data-slot=table-container]]:-mx-4 [&>[data-slot=table-container]]:w-[calc(100%+2rem)] [&_table_tr>:first-child]:pl-4 [&_table_tr>:last-child]:pr-4">
    {!accountId && <div className="border px-4 py-8 text-center text-muted-foreground">Connect a passkey to view your trades.</div>}
    {accountId && query.error && (trades.length ? <div className="space-y-2"><Alert variant="destructive"><AlertCircle /><AlertDescription>Unable to refresh trades.</AlertDescription></Alert>{retry("Retry")}</div> : <div className="flex flex-col items-center gap-2 py-8 text-center"><AlertCircle className="size-5 text-destructive" aria-hidden="true" /><p role="alert">Unable to load trades</p>{retry("Retry")}</div>)}
    {accountId && query.isSuccess && !trades.length && <div className="border px-4 py-8 text-center text-muted-foreground">No market trades yet.</div>}
    {accountId && (loading || !!trades.length) && <Table timeColumn={4} aria-label="My trades" className="min-w-[640px]" columnWidths={[140, 72, 160, 160, 140, 120]} loading={loading} loadingLabel="Loading trades">
      <TableHeader><TableRow><TableHead>Market</TableHead><TableHead>Side</TableHead><TableHead className="text-right">Input</TableHead><TableHead>Status</TableHead><TableHead>Time</TableHead><TableHead><span className="sr-only">Action</span></TableHead></TableRow></TableHeader>
      <TableBody>
        {loading && <TableSkeletonRows columns={6} />}
        {trades.map(trade => {
          const pair = trade.review.pair ?? TERMINAL_PAIR;
          const label = status(trade);
          const uncertain = !!trade.syncError || trade.state === "unknown";
          return <TableRow key={trade.id} tabIndex={0} aria-label={`View trade details, ${label}`} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring" onClick={event => { if (!(event.target as HTMLElement).closest("button,a")) setDetailsId(trade.id); }} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); setDetailsId(trade.id); } }}>
            <TableCell>{"assetId" in pair.base ? displaySymbol(pair.base) : pair.base.symbol}/{"assetId" in pair.quote ? displaySymbol(pair.quote) : pair.quote.symbol}</TableCell><TableCell>{trade.review.side === "buy" ? "Buy" : "Sell"}</TableCell>
            <TableCell className="text-right"><FormattedNumber value={trade.review.principal} symbol={trade.review.inputSymbol} format="exact" /></TableCell>
            <TableCell><span className="inline-flex items-center gap-2">{uncertain ? <AlertCircle /> : label === "Processing" ? <LoaderCircle  /> : null}<span className={trade.syncError || trade.state === "failed" ? "text-destructive" : undefined}>{label}</span></span></TableCell>
            <TableCell><time dateTime={new Date(trade.createdAt).toISOString()} title={new Date(trade.createdAt).toLocaleString()}>{new Date(trade.createdAt).toLocaleDateString()}</time></TableCell>
            <TableCell>{uncertain && retry("Check status")}</TableCell>
          </TableRow>;
        })}
      </TableBody>
    </Table>}
    <DialogDrawer open={!!selected && !!accountId} onOpenChange={open => { if (!open) setDetailsId(""); }}><DialogDrawerContent><DialogDrawerHeader><DialogDrawerTitle>Trade details</DialogDrawerTitle></DialogDrawerHeader>
      {selected && <div className="space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt>Side</dt><dd className="text-right">{selected.review.side === "buy" ? "Buy" : "Sell"}</dd>
          <dt>Input</dt><dd className="text-right"><FormattedNumber value={selected.review.principal} symbol={selected.review.inputSymbol} format="exact" /></dd>
          <dt>Estimated output</dt><dd className="text-right"><FormattedNumber value={selected.review.estimatedOutput} symbol={selected.review.outputSymbol} format="exact" /></dd>
          <dt>Minimum received</dt><dd className="text-right"><FormattedNumber value={selected.review.minimumOutput} symbol={selected.review.outputSymbol} format="exact" /></dd>
          <dt>Status</dt><dd className="text-right">{status(selected)}</dd>
          {selected.syncError && <><dt>Last known status</dt><dd className="text-right">{status({ ...selected, syncError: false })}</dd></>}
        </dl>
        <div><p className="text-muted-foreground">Trade ID</p><p className="break-all">{selected.id}</p></div>
        {selected.intentHash && <div><p className="text-muted-foreground">Intent ID</p><p className="break-all">{selected.intentHash}</p></div>}
        {[...new Set(selected.nearTxHashes ?? [])].map((hash, i) => { const url = nearTransactionUrl(hash); return url && <a className="flex items-center gap-2 underline" key={hash} href={url} target="_blank" rel="noopener noreferrer">Transaction {i + 1}<ExternalLink className="size-4" aria-hidden="true" /></a>; })}
        <time dateTime={new Date(selected.createdAt).toISOString()}>{new Date(selected.createdAt).toLocaleString()}</time>
      </div>}
    </DialogDrawerContent></DialogDrawer>
  </section>;
}
