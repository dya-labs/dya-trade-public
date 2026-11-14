"use client";
import { useCallback, useState, type ComponentProps } from "react";
import { useBalanceQuery } from "./use-live-balances";
import { useCatalogQuery } from "@dya/wallet-ui/hooks/use-wallet-queries";
import { depositSources, networkName } from "@/lib/near/domain/deposit-assets";
import { DEFAULT_PAIR, makePair, type CatalogAsset } from "@/lib/near/domain/catalog";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { formatTokenAmount } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@dya/ui/components/select";
import { OrderTicketForm } from "./ticket";

export function OrderTicket(props: ComponentProps<typeof OrderTicketForm>) {
  const pair = props.pair ?? DEFAULT_PAIR;
  const catalog = useCatalogQuery();
  const canonicalBase = catalog.data?.assets.find(asset => asset.assetId === pair.base.assetId) ?? pair.base;
  const balances = useBalanceQuery(props.outlayer ? null : props.account?.id ?? null);
  const holdings = props.outlayer?.wallet.assets ?? balances.data?.assets;
  const [baseId, setBaseId] = useState(pair.base.assetId);
  const [busy, setBusy] = useState(false);
  const parentBusy = props.onBusyChange;
  const reportBusy = useCallback((value: boolean) => { setBusy(value); parentBusy?.(value); }, [parentBusy]);
  function choices(asset: CatalogAsset) {
    const variants = depositSources(asset, catalog.data?.assets ?? []);
    return [asset, ...variants.filter(a => a.assetId !== asset.assetId && holdings?.some(b => b.assetId === a.assetId && b.raw !== "0"))];
  }
  const bases = choices(canonicalBase);
  // Retain explicitly selected identities even after spending their balance.
  const base = depositSources(canonicalBase, catalog.data?.assets ?? []).find(a => a.assetId === baseId) ?? canonicalBase;
  const quote = DEFAULT_PAIR.quote;
  if (!bases.some(a => a.assetId === base.assetId)) bases.push(base);
  const selected = makePair(base, quote);
  const balanceLabel = (asset: CatalogAsset) => {
    const amount = holdings?.find(b => b.assetId === asset.assetId)?.amount;
    return `${networkName(asset.blockchain)} · ${amount === undefined ? "-" : formatTokenAmount(amount, displaySymbol(asset))} ${displaySymbol(asset)}`;
  };
  return <div className="flex min-h-full flex-col">
    {props.account && bases.length > 1 && <div className="space-y-2 px-4 pt-3">
      <p className="text-xs text-muted-foreground">Choose the asset network. Trading uses USDC on NEAR.</p>
      {([{ label: `${displaySymbol(pair.base)} balance`, options: bases, value: base.assetId, select: setBaseId }]).filter(group => group.options.length > 1).map(group => <Select key={group.label} items={group.options.map(asset => ({ value: asset.assetId, label: balanceLabel(asset) }))} value={group.value} disabled={busy} onValueChange={value => { if (value) group.select(value); }}><SelectTrigger className="w-full" aria-label={group.label}><SelectValue /></SelectTrigger><SelectContent>{group.options.map(a => <SelectItem key={a.assetId} value={a.assetId}>{balanceLabel(a)}</SelectItem>)}</SelectContent></Select>)}
    </div>}
    <OrderTicketForm {...props} key={selected.id} pair={selected} onBusyChange={reportBusy} />
  </div>;
}
