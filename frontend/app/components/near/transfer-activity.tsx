"use client";
import { ActivityTable as Table } from "./activity-table";
import { ChainsPath } from "@dya/wallet-ui/components/near/chains-path";
import { ActivityTime } from "./activity-time";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { useState } from "react";
import { AlertCircle, LoaderCircle } from "@dya/ui/icons";
import type { TrackedDepositQuote } from "@/lib/near/http/schemas/transfers";
import { isAwaitingDeposit, depositStatusLabel } from "@/lib/near/domain/deposit-activity";
import { BridgeActivity, useBridgeActivity } from "./bridge-activity";
import { TableSkeletonRows } from "@dya/ui/components/table-skeleton";
import { useTransfers } from "./use-activity";
import { Button } from "@dya/ui/components/button";
import { ActivityEmpty, ActivityRecovery, ActivityRefreshStatus, oldestUpdate } from "./activity-state";
import { ActivityDetailRow } from "@dya/ui/components/activity-detail";
import { TransferDetailSummary } from "./transfer-detail-summary";
import { DialogDrawer } from "@dya/ui/components/dialog-drawer";
import { ActivityDetailContent as DialogDrawerContent } from "@dya/ui/components/activity-detail";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dya/ui/components/table";
import { ActivityTransactions } from "./activity-transactions";
import { TransferAddress } from "./transfer-address";


export function TransferActivity({ accountId, openTransfers }: { accountId: string | null; openTransfers: () => void; openDeposit: (quote: TrackedDepositQuote) => void }) {
  const query = useTransfers(accountId);
  const bridge = useBridgeActivity(accountId);
  const [detailsId, setDetailsId] = useState("");
  const deposits = query.data?.deposits ?? [];
  const activity = [
    ...deposits.filter(item => !isAwaitingDeposit(item)).map(item => ({ kind: "deposit" as const, item, createdAt: item.createdAt })),
    ...(query.data?.withdrawals ?? []).map(item => ({ kind: "withdrawal" as const, item, createdAt: item.createdAt })),
  ].sort((a, b) => b.createdAt - a.createdAt);
  const selected = activity.find(entry => `${entry.kind}-${entry.item.id}` === detailsId);
  const initialLoading = !!accountId && ((!query.data && query.isPending) || (!bridge.data && bridge.isPending));
  const hasRows = activity.length > 0 || !!bridge.data?.deposits.length;
  const unavailable = !!query.error || !!bridge.error;
  const fetching = query.isFetching || bridge.isFetching;
  const refresh = () => { void query.refetch(); void bridge.refetch(); };
  const retry = <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching && <LoaderCircle  />}{query.isFetching ? "Checking…" : "Check status"}</Button>;
  function status(entry: typeof activity[number]) {
    if (query.data?.unavailableIds?.includes(entry.item.id)) return "Status unavailable";
    if (entry.kind === "deposit") return depositStatusLabel(entry.item.status);
    return entry.item.state === "settled" ? "Completed" : entry.item.state === "failed" ? "Failed" : entry.item.state === "unknown" ? "Unconfirmed" : "Processing";
  }
  return <section aria-label="Transfers" className="space-y-4 px-4 [&>[data-slot=table-container]]:-mx-4 [&>[data-slot=table-container]]:w-[calc(100%+2rem)] [&_table_tr>:first-child]:pl-4 [&_table_tr>:last-child]:pr-4">
    {!accountId ? <ActivityEmpty className="-mx-4">Connect a passkey to view transfers.</ActivityEmpty> : !initialLoading && !hasRows && (unavailable ? <ActivityRecovery onRetry={refresh} retrying={fetching}>Couldn’t load transfers</ActivityRecovery> : <ActivityEmpty className="-mx-4" action={<Button size="sm" variant="outline" onClick={openTransfers}>Deposit</Button>}>No transfers yet.</ActivityEmpty>)}
    {accountId && (initialLoading || !!activity.length || !!bridge.data?.deposits.length) && <Table className="min-w-[640px]" aria-label="Transfers" columnWidths={[160, 120, 192, 160, 160, 120]} loading={initialLoading && !hasRows} loadingLabel="Loading transfers">
      <TableHeader><TableRow>{["Time", "Type", "Route", "Amount", "Status", "Action"].map(label => <TableHead key={label} className={label === "Amount" ? "text-right" : undefined}>{label === "Action" ? <span className="sr-only">Action</span> : label}</TableHead>)}</TableRow></TableHeader>
      <TableBody>
        {initialLoading && !hasRows && <TableSkeletonRows columns={6} />}
        {activity.map(entry => {
          const label = status(entry);
          const warning = ["Status unavailable", "Unconfirmed"].includes(label);
          const route = entry.kind === "deposit" ? <ChainsPath from={entry.item.quote.sourceChain} to="NEAR Intents" /> : <ChainsPath from="NEAR Intents" to={entry.item.review.destinationChain} />;
          // Deposit quotes are estimates; show only the amount 1Click reports as credited.
          const amount = entry.kind === "deposit" ? <FormattedNumber value={entry.item.creditedAmount} symbol={entry.item.quote.asset} exactTooltip /> : <FormattedNumber value={entry.item.review.amount} symbol={entry.item.review.asset} exactTooltip />;
          return <TableRow key={`${entry.kind}-${entry.item.id}`} tabIndex={0} aria-label={`View ${entry.kind} transfer details, ${label}`} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring" onClick={event => { if (!(event.target as HTMLElement).closest("button,a")) setDetailsId(`${entry.kind}-${entry.item.id}`); }} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); setDetailsId(`${entry.kind}-${entry.item.id}`); } }}>
            <TableCell><ActivityTime value={entry.createdAt} /></TableCell>
            <TableCell>{entry.kind === "deposit" ? "Deposit" : "Withdrawal"}</TableCell>
            <TableCell>{route}</TableCell><TableCell className="text-right">{amount}</TableCell>
            <TableCell><span className="inline-flex items-center gap-2">
              {warning ? <AlertCircle className="text-destructive" /> : label === "Processing" ? <LoaderCircle  /> : null}
              <span className={["Failed", "Status unavailable"].includes(label) ? "text-destructive" : undefined}>{label}</span>
            </span></TableCell>
            <TableCell>{warning && retry}</TableCell>
          </TableRow>;
        })}
      {!!bridge.data?.deposits.length && <BridgeActivity query={bridge} asRows />}
      </TableBody>
    </Table>}
    {accountId && unavailable && hasRows && <ActivityRefreshStatus lastUpdatedAt={oldestUpdate(query.dataUpdatedAt, bridge.dataUpdatedAt)} onRetry={refresh} retrying={fetching}>{bridge.error && !query.error ? "Direct deposit updates delayed" : "Updates delayed"}</ActivityRefreshStatus>}
    <DialogDrawer open={!!selected && !!accountId} onOpenChange={open => { if (!open) setDetailsId(""); }}><DialogDrawerContent>
      {selected && <TransferDetailSummary direction={selected.kind} status={status(selected)}
        symbol={selected.kind === "deposit" ? selected.item.quote.asset : selected.item.review.asset}
        assetId={selected.kind === "deposit" ? selected.item.quote.targetAssetId : selected.item.review.originAsset}
        amount={selected.kind === "deposit" ? selected.item.creditedAmount : selected.item.review.amount}
        subtitle={<ActivityTime value={selected.createdAt} />}>
        {query.data?.unavailableIds?.includes(selected.item.id) && <p className="text-muted-foreground">Last known status: {selected.kind === "deposit" ? depositStatusLabel(selected.item.status) : selected.item.state === "settled" ? "Completed" : selected.item.state === "failed" ? "Failed" : selected.item.state === "unknown" ? "Unconfirmed" : "Processing"}</p>}
        <ActivityDetailRow label="Route"><ChainsPath from={selected.kind === "deposit" ? selected.item.quote.sourceChain : "NEAR Intents"} to={selected.kind === "deposit" ? "NEAR Intents" : selected.item.review.destinationChain} labelSide={selected.kind === "deposit" ? "from" : "to"} /></ActivityDetailRow>
        {selected.kind === "deposit" ? <>
          <TransferAddress label="From" network={selected.item.quote.sourceChain} />
          {selected.item.creditedAmount === undefined && <p className="text-muted-foreground">Received amount will appear after settlement.</p>}
          <ActivityTransactions hashes={selected.item.originChainTxHashes} network={selected.item.quote.sourceChain} label="Source transaction" />
          <ActivityTransactions hashes={selected.item.destinationChainTxHashes} network="NEAR" label="Destination transaction" />
        </> : <>
          <TransferAddress label="To" address={selected.item.review.destinationWallet} network={selected.item.review.destinationChain} />
          <ActivityTransactions hashes={selected.item.originChainTxHashes} network="NEAR" label="Source transaction" />
          <ActivityTransactions hashes={selected.item.destinationChainTxHashes} network={selected.item.review.destinationChain} label="Destination transaction" />
          {selected.item.state !== "settled" && <p className="text-xs text-muted-foreground">Amount shown is the submitted amount.</p>}
        </>}
        {!selected.item.originChainTxHashes?.length && !selected.item.destinationChainTxHashes?.length && <ActivityDetailRow label="Transaction"><span className="text-muted-foreground">Unavailable</span></ActivityDetailRow>}
        {["Unconfirmed", "Status unavailable"].includes(status(selected)) && retry}
      </TransferDetailSummary>}
    </DialogDrawerContent></DialogDrawer>
  </section>;
}
