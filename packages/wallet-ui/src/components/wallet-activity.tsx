"use client";
import { AccountAvatar } from "@dya/ui/components/account-avatar";
import { TradingAccountBadge } from "@dya/ui/components/trading-account-badge";
import { toast } from "@dya/ui/lib/toast";
import { useWalletOperations } from "../hooks/use-wallet-operations";
import { Card, CardContent } from "@dya/ui/components/card";
import { type ReactNode } from "react";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { useEffect, useState } from "react";
import { useTransfers, useTransferStatusMutation } from "../hooks/use-transfers";
import { useCatalogQuery } from "../hooks/use-wallet-queries";
import { Button } from "@dya/ui/components/button";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { DialogDrawer, DialogDrawerContent, DialogDrawerHeader, DialogDrawerTitle, DialogDrawerDescription } from "@dya/ui/components/dialog-drawer";
import { LoaderCircle, ExternalLink, ArrowDownLeft, ArrowUpRight } from "@dya/ui/icons";
import { depositStatusLabel } from "../lib/near/domain/deposit-activity";
import { bscTransactionUrl, nearTransactionUrl } from "@dya/wallet-contracts/src/domain/explorer";
import { AssetMark } from "./near/asset-mark";
import { WalletSection, WalletSectionHeader, WalletSectionContent } from "./wallet-section";
import { WalletActivityRow } from "./wallet-activity-row";
import { RelativeTime } from "./relative-time";
import { RecipientAddress } from "./near/recipient-address";

export function WalletActivityList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-foreground/10">{children}</div>;
}

export function ActivityState({ title, children, action, error = false }: { title: string; children: ReactNode; action?: ReactNode; error?: boolean }) {
  return <Card size="sm" className="py-0"><CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center">
    <div role={error ? "alert" : "status"} className="space-y-2"><p className="text-sm font-medium">{title}</p><p className="text-sm text-muted-foreground">{children}</p></div>
    {action && <div className="mt-2">{action}</div>}
  </CardContent></Card>;
}

export function activityDay(timestamp: number, now: number) {
  const date = new Date(timestamp), today = new Date(now);
  if (!Number.isFinite(date.getTime())) return { key: "unknown", label: "Date unavailable" };
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const sameDay = (other: Date) => date.getFullYear() === other.getFullYear() && date.getMonth() === other.getMonth() && date.getDate() === other.getDate();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  return { key, label: sameDay(today) ? "Today" : sameDay(yesterday) ? "Yesterday" : date.toLocaleDateString("en-GB", { day: "numeric", month: "long", ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" as const } : {}) }) };
}

const transferLabels = {
  send: { pending: "Send", complete: "Sent", preposition: "to" },
  receive: { pending: "Receive", complete: "Received", preposition: "from" },
} as const;
type TransferKind = keyof typeof transferLabels;

function transferTitle(kind: TransferKind, symbol: string, complete: boolean, counterpartyName?: string) {
  const labels = transferLabels[kind];
  const title = `${complete ? labels.complete : labels.pending} ${symbol}`;
  return counterpartyName ? `${title} ${labels.preposition} ${counterpartyName}` : title;
}

function TransferTitle({ title, showBadge }: { title: string; showBadge?: boolean }) {
  return <span className="inline-flex max-w-full items-center gap-2">
    <span className="min-w-0 truncate">{title}</span>
    {showBadge && <TradingAccountBadge />}
  </span>;
}

export type ActivityDeposit = {
  id: string;
  createdAt: number;
  status: Parameters<typeof depositStatusLabel>[0];
  counterpartyAvatarSeed?: string; counterpartyIsTrading?: boolean; counterpartyName?: string;
  creditedAmount?: string;
  originChainTxHashes?: string[];
  quote: { asset: string; sourceNetwork?: string; sourceChain: string; sourceAssetId?: string };
};

type ActivitySource = {
  deposits?: ActivityDeposit[];
  withdrawals?: {
    id: string; createdAt: number; state: "settled" | "failed" | "unknown" | "submitted";
    counterpartyAvatarSeed?: string; counterpartyIsTrading?: boolean; counterpartyName?: string; amount: string; asset: string; network: string; chain: string; assetId: string; address: string;
  }[];
  items: { id: string; title: string; status: string; time: number; incoming: boolean }[];
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => unknown;
};

export function WalletActivity({ source, accountId, limit, pageSize, href, hideHeading = false, groupByDay = false, onReceive, receiveDisabled = false }: { source?: ActivitySource; onReceive?: () => void; receiveDisabled?: boolean; accountId: string; limit?: number; pageSize?: number; href?: string; hideHeading?: boolean; groupByDay?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!groupByDay) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [groupByDay]);
  const [visible, setVisible] = useState(pageSize ?? 20);
  const query = useTransfers(source ? null : accountId);
  const catalog = useCatalogQuery();
  const operations = useWalletOperations(accountId, !source);
  const [selectedOperationId, setSelectedOperationId] = useState("");
  const selectedOperation = operations.items.find(item => item.id === selectedOperationId);
  const check = useTransferStatusMutation(accountId);
  const [selectedId, setSelectedId] = useState("");
  const items = [
    ...(source?.withdrawals ?? []).map(item => ({
      id: item.id, counterpartyAvatarSeed: item.counterpartyAvatarSeed, counterpartyIsTrading: item.counterpartyIsTrading, counterpartyName: item.counterpartyName, kind: "send" as const, time: item.createdAt, symbol: item.asset,
      amount: item.amount, network: item.network, chain: item.chain, assetId: item.assetId,
      address: item.address, hashes: undefined,
      state: item.state === "settled" ? "Completed" : item.state === "failed" ? "Failed" : item.state === "unknown" ? "Unconfirmed" : "Processing",
    })),
    ...(query.data?.withdrawals ?? []).map(item => ({ id: item.id, counterpartyAvatarSeed: item.counterpartyAvatarSeed, counterpartyIsTrading: item.counterpartyIsTrading, counterpartyName: item.counterpartyName, kind: "send" as const, time: item.createdAt, symbol: item.review.asset, amount: item.review.amount, network: item.review.route?.destination.blockchain, chain: item.review.destinationChain, assetId: item.review.destinationAsset, address: item.review.destinationWallet, state: item.state === "settled" ? "Completed" : item.state === "failed" ? "Failed" : item.state === "unknown" ? "Unconfirmed" : "Processing", hashes: item.destinationChainTxHashes })),
    ...(source?.deposits ?? [...(query.data?.deposits ?? []).map(deposit => ({ ...deposit, counterpartyAvatarSeed: undefined, counterpartyIsTrading: undefined, counterpartyName: undefined })), ...(query.data?.internalReceipts ?? [])]).map(item => ({ id: item.id, counterpartyAvatarSeed: item.counterpartyAvatarSeed, counterpartyIsTrading: item.counterpartyIsTrading, counterpartyName: item.counterpartyName, kind: "receive" as const, time: item.createdAt, symbol: item.quote.asset, amount: item.creditedAmount ?? "-", network: item.quote.sourceNetwork, chain: item.quote.sourceChain, assetId: item.quote.sourceAssetId, address: undefined, state: depositStatusLabel(item.status), hashes: item.originChainTxHashes })),
  ].sort((a, b) => b.time - a.time);
  const selected = items.find(item => `${item.kind}:${item.id}` === selectedId);
  const status = (item: typeof items[number]) => query.data?.unavailableIds.includes(item.id) ? "Status unavailable" : item.state;
  const needsCheck = (item: typeof items[number]) => !(source && item.kind === "send") && ["Status unavailable", "Unconfirmed"].includes(status(item));
  const error = query.isError ? query.data ? "Activity updates delayed · showing last known transfers." : "Couldn’t load transfer activity." : "";
  const checkButton = (item: typeof items[number]) => <Button variant="outline" size="sm" disabled={check.isPending} onClick={() => check.mutate({ id: item.id, kind: item.kind })}>{check.isPending && check.variables.id === item.id && <LoaderCircle  />}{check.isPending && check.variables.id === item.id ? "Checking…" : "Check status"}</Button>;
  const transferSubtitle = (label: string, time: number) => <>
    <span className={["Processing", "Completed"].includes(label) ? "sr-only" : undefined}>{label} · </span>
    <RelativeTime timestamp={time} format={groupByDay ? "time" : "relative"} />
  </>;
  const renderTransfer = (item: typeof items[number]) => {
    const metadata = catalog.data?.assets.find(asset => asset.assetId === item.assetId);
    const label = status(item);
    const title = transferTitle(item.kind, item.symbol, item.state === "Completed", item.counterpartyName);
    return <div key={`${item.kind}:${item.id}`} className="flex items-center gap-3 [&>button:last-child:not(:first-child)]:mr-3">
      <WalletActivityRow ariaLabel={`View ${title} details, ${label}`} onClick={() => { check.reset(); setSelectedId(`${item.kind}:${item.id}`); }}
        icon={<AssetMark asset={metadata ?? {assetId:item.assetId ?? item.id,symbol:item.symbol,decimals:0,blockchain:item.network ?? "unknown"}} size={36} processing={label === "Processing"} network={item.network ?? metadata?.blockchain} badge={item.counterpartyName && <AccountAvatar seed={item.counterpartyAvatarSeed} size="sm" className="data-[size=sm]:size-4" />} />}
        title={<TransferTitle title={title} showBadge={!!item.counterpartyName && item.counterpartyIsTrading} />}
        subtitle={transferSubtitle(label, item.time)}
        amount={<><FormattedNumber value={item.amount} unit={item.symbol} exactTooltip />{item.kind === "send" && !["Completed","Failed"].includes(item.state) && <span className="block text-xs text-muted-foreground">Pending</span>}</>}
      />{needsCheck(item) && checkButton(item)}
    </div>;
  };
  const operationState = (state: string) => state === "settled" ? "" : state === "failed" ? "Failed or refunded" : state === "unknown" ? "Checking status" : "Processing";
  const rows = source ? [...items.map(item => ({ time: item.time, content: renderTransfer(item) })), ...source.items.map(item => {
    const Icon = item.incoming ? ArrowDownLeft : ArrowUpRight;
    return { time: item.time, content: <WalletActivityRow key={item.id} className="px-3"
      icon={<Icon className="size-9 rounded-full bg-muted p-2" aria-hidden="true" />}
      title={item.title}
      subtitle={transferSubtitle(item.status, item.time)}
      amount={null} /> };
  })] : [
    ...items.map(item => ({ time: item.time, content: renderTransfer(item) })),
    ...operations.items.map(item => ({ time: item.time, content: <div key={item.id}><WalletActivityRow onClick={() => setSelectedOperationId(item.id)} ariaLabel={`View ${item.title} details`} icon={<AssetMark asset={item.asset} network={item.asset.blockchain} badge={item.tradeSide === "buy" ? <ArrowDownLeft className="size-3.5 text-success" /> : item.tradeSide === "sell" ? <ArrowUpRight className="size-3.5 text-destructive" /> : undefined} size={36} processing={["submitting", "submitted", "unknown"].includes(item.state)} />} title={item.title} subtitle={<>{operationState(item.state) && <>{operationState(item.state)} · </>}<RelativeTime timestamp={item.time} format={groupByDay ? "time" : "relative"} /></>} amount={<FormattedNumber value={item.amount} symbol={item.asset.symbol} fractionDigits={["USDC", "USDT", "DAI"].includes(item.asset.symbol) ? 2 : undefined} estimated title="Estimated received amount" />} /></div> })),
  ];
  const count = limit ?? (pageSize ? visible : rows.length);
  const visibleRows = rows.sort((a, b) => (Number.isFinite(new Date(b.time).getTime()) ? b.time : -Infinity) - (Number.isFinite(new Date(a.time).getTime()) ? a.time : -Infinity)).slice(0, count);
  const groups = new Map<string, { label: string; rows: typeof rows }>();
  if (groupByDay) for (const row of visibleRows) {
    const day = activityDay(row.time, now);
    const group = groups.get(day.key) ?? { label: day.label, rows: [] };
    group.rows.push(row); groups.set(day.key, group);
  }

  const pending = source?.isPending ?? (query.isPending || operations.isPending);
  const failed = source?.isError ?? (!!error || operations.isError);
  const fetching = source?.isFetching ?? (query.isFetching || operations.isFetching);
  function retry() {
    if (source) { void source.refetch(); return; }
    void query.refetch();
    void operations.refetch();
  }

  const partialErrorFooter = !!rows.length && failed && <div className="flex items-center justify-between gap-3 border-t border-foreground/10 px-3 py-2">
      <p role="status" className="text-sm text-muted-foreground">Some activity couldn’t be updated.</p>
      <Button variant="link" size="sm" disabled={fetching} onClick={retry}>Retry</Button>
    </div>;

  return <WalletSection aria-label="Transfer activity">{!hideHeading && <WalletSectionHeader href={rows.length ? href : undefined}>Activity</WalletSectionHeader>}<WalletSectionContent unboxed={groupByDay || !rows.length}>{!rows.length && pending ? <p role="status">Loading activity…</p> : rows.length ? groupByDay ? <div className="space-y-6">{[...groups].map(([key, group]) => <WalletSection key={key} aria-label={group.label}><WalletSectionHeader>{group.label}</WalletSectionHeader><WalletSectionContent><div className="divide-y divide-foreground/10">{group.rows.map(row => row.content)}</div></WalletSectionContent></WalletSection>)}</div> : <div><WalletActivityList>{visibleRows.map(row => row.content)}</WalletActivityList>{partialErrorFooter}</div> : !failed && <ActivityState title="No activity yet" action={onReceive && <Button variant="outline" disabled={receiveDisabled} onClick={onReceive}><ArrowDownLeft />Receive</Button>}>{onReceive ? "Receive assets to get started." : "Your transfers and trades will appear here."}</ActivityState>}{!rows.length && !pending && failed && <ActivityState title="Activity unavailable" error action={<Button variant="outline" disabled={fetching} onClick={retry}>Retry activity</Button>}>We couldn’t load your activity. Please try again.</ActivityState>}
    {pageSize && rows.length > count && <Button variant="outline" onClick={() => setVisible(n => n + pageSize)}>Load more</Button>}
    {groupByDay && partialErrorFooter}

    </WalletSectionContent>
    <DialogDrawer open={!!selectedOperation} onOpenChange={open => { if (!open) setSelectedOperationId(""); }}><DialogDrawerContent><DialogDrawerHeader><DialogDrawerTitle>{selectedOperation?.title ?? "Activity details"}</DialogDrawerTitle><DialogDrawerDescription className="sr-only">Trade or funding transfer amounts and status.</DialogDrawerDescription></DialogDrawerHeader>{selectedOperation && <div className="space-y-3"><p>{selectedOperation.state === "settled" ? "Completed" : operationState(selectedOperation.state)}</p><dl className="space-y-2 text-sm"><div className="flex justify-between gap-3"><dt>Sent</dt><dd><FormattedNumber value={selectedOperation.inputAmount} symbol={selectedOperation.inputSymbol} format="exact" /></dd></div><div className="flex justify-between gap-3"><dt>Estimated received</dt><dd><FormattedNumber value={selectedOperation.amount} symbol={selectedOperation.asset.symbol} format="exact" /></dd></div><div className="flex justify-between gap-3"><dt>Minimum received</dt><dd><FormattedNumber value={selectedOperation.minimum} symbol={selectedOperation.asset.symbol} format="exact" /></dd></div></dl><RelativeTime timestamp={selectedOperation.time} format="full" />{selectedOperation.hashes.map(hash => <a key={hash} href={nearTransactionUrl(hash) ?? undefined} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 underline">View transaction<ExternalLink className="size-4" /></a>)}</div>}</DialogDrawerContent></DialogDrawer>
    <DialogDrawer open={!!selected} onOpenChange={open => { if (!open) setSelectedId(""); }}><DialogDrawerContent><DialogDrawerHeader><DialogDrawerTitle>Transfer details</DialogDrawerTitle><DialogDrawerDescription className="sr-only">Transfer status, network, recipient, and transaction information.</DialogDrawerDescription></DialogDrawerHeader>{selected && <div className="space-y-4">
      <p><TransferTitle title={transferTitle(selected.kind, selected.symbol, selected.state === "Completed", selected.counterpartyName)} showBadge={!!selected.counterpartyName && selected.counterpartyIsTrading} /> · {status(selected)}</p><p><FormattedNumber value={selected.amount} symbol={selected.symbol} format="exact" /> · {selected.chain}</p>
      {selected.kind === "send" && !["Completed","Failed"].includes(selected.state) && <p className="text-sm text-muted-foreground">Pending amount</p>}
      {selected.address && <RecipientAddress address={selected.address} network={selected.network} onCopyError={message => toast.error(message)} />}
      {(selected.hashes ?? []).map(hash => {
        const network = selected.network ?? selected.chain;
        const url = ["near","NEAR"].includes(network) ? nearTransactionUrl(hash) : ["bsc","BSC","BNB Smart Chain"].includes(network) ? bscTransactionUrl(hash) : null;
        return url ? <a key={hash} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 underline">View transaction<ExternalLink className="size-4" /></a> : <p key={hash} className="break-all text-sm">{hash}</p>;
      })}
      <div><p className="text-muted-foreground">Transfer ID</p><p className="break-all">{selected.id}</p></div><RelativeTime timestamp={selected.time} format="full" />
      {check.isError && needsCheck(selected) && <Alert variant="destructive"><AlertDescription>Status unavailable. Check again before resubmitting.</AlertDescription></Alert>}{needsCheck(selected) && checkButton(selected)}
    </div>}</DialogDrawerContent></DialogDrawer>
  </WalletSection>;
}
