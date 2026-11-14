"use client";
import { WalletAccountMenuItem } from "@dya/wallet-ui/components/wallet-account-menu-item";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@dya/ui/components/dropdown-menu";
import { DYA_WALLET_NAMES } from "@dya/config";
import { TradingAccountBadge } from "@dya/ui/components/trading-account-badge";
import { WalletActivity } from "@dya/wallet-ui/components/wallet-activity";
import { useTradingWallet } from "@dya/wallet-ui/hooks/use-trading-wallet";
import { ChevronDown } from "@dya/ui/icons";
import { WalletSettings } from "./wallet-settings";
import { ConfidentialAccessRequired } from "@/lib/near/domain/confidential-access-error";
import { ConfidentialAccess } from "./confidential-access";
import { z } from "zod";
import { request } from "@dya/wallet-ui/lib/near/http/request";
import { useState } from "react";
import { WalletActivityRow } from "@dya/wallet-ui/components/wallet-activity-row";
import { WalletSection, WalletSectionContent, WalletSectionEmpty } from "@dya/wallet-ui/components/wallet-section";
import { WalletAssets } from "@dya/wallet-ui/components/wallet-assets";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@dya/ui/components/tabs";
import { getMarketTrades } from "@/lib/near/http/trading-client";
import { RelativeTime } from "@dya/wallet-ui/components/relative-time";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, ArrowRight, SettingsFilled, Wallet, WifiOff, LoaderCircle } from "@dya/ui/icons";
import { AccountAvatar } from "@dya/ui/components/account-avatar";
import { Button, buttonVariants } from "@dya/ui/components/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@dya/ui/components/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@dya/ui/components/tooltip";
import { MeasuredSkeleton } from "@dya/ui/components/skeleton";
import { AssetMark } from "./asset-mark";
import { useBalanceQuery } from "./use-live-balances";
import { useCatalogQuery } from "@dya/wallet-ui/hooks/use-wallet-queries";
import { getTokenMarkets } from "@/lib/near/http/catalog-client";
import { getBridgeDeposits, getWithdrawals, getDeposits } from "@/lib/near/http/transfers-client";
import { networkFor } from "@/lib/near/domain/bridge-networks";
import { NetworkMark } from "./network-mark";
import { networkName } from "@/lib/near/domain/deposit-assets";
import { isAwaitingDeposit, depositStatusLabel } from "@/lib/near/domain/deposit-activity";
import { fundingHistory } from "@/lib/near/http/funding-conversions-client";
import { fundingAssets } from "@/lib/near/domain/funding-balances";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { D } from "@/lib/near/domain/decimal";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import type { Snapshot } from "@/lib/near/http/schemas/account";

export function WalletMenu({ account, idOrigin, onDeposit, onWithdraw, onFunding, onSignOut, onActivity, tradingWallet, onSelectWallet, busy = false }: {
  account: NonNullable<Snapshot["account"]>;
  idOrigin?: string;
  tradingWallet?: { id: string; name: string };
  onSelectWallet?: (id: string | null) => void;
  busy?: boolean;
  onDeposit: () => void; onWithdraw: () => void; onFunding: () => void; onSignOut: () => void; onActivity: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wallets = account.tradingWallets ?? [];
  const name = tradingWallet?.name ?? (wallets.length ? DYA_WALLET_NAMES.main : account.name || "Wallet");
  const seed = tradingWallet?.id ?? account.intentsIdentity?.accountId ?? account.id;
  const tradeAccess = useQuery({
    queryKey: ["outlayer", "trade-access", tradingWallet?.id],
    enabled: open && !!tradingWallet,
    queryFn: () => request(`outlayer/send-policy/trade-access?${new URLSearchParams({ account: tradingWallet!.id })}`, z.object({ enabled: z.boolean() }), {}),
  });
  const [settings, setSettings] = useState(false);
  const [tab, setTab] = useState("assets");
  const assetsUrl = idOrigin ? new URL("/assets", idOrigin).href : undefined;
  const activityUrl = idOrigin ? new URL("/activity", idOrigin).href : undefined;
  const trades = useQuery({ queryKey: ["near", "account", account.id, "wallet-trades"], queryFn: ({ signal }) => getMarketTrades(signal), enabled: open, staleTime: 30000 });
  const balances = useBalanceQuery(account.id);
  const catalog = useCatalogQuery();
  const markets = useQuery({ queryKey: ["near", "token-markets"], queryFn: ({ signal }) => getTokenMarkets(signal), enabled: open, staleTime: 300000 });
  const history = useQuery({ queryKey: ["near", "account", account.id, "funding", "confidential", "wallet"], queryFn: fundingHistory, enabled: open, staleTime: 30000 });
  const withdrawals = useQuery({ queryKey: ["near", "account", account.id, "transfers", "confidential", "wallet-withdrawals"], queryFn: ({ signal }) => getWithdrawals(signal), enabled: open, staleTime: 30000 });
  const deposits = useQuery({ queryKey: ["near", "account", account.id, "transfers", "confidential", "wallet-deposits"], queryFn: ({ signal }) => getDeposits(signal), enabled: open, staleTime: 30000 });
  const bridge = useQuery({ queryKey: ["near", "account", account.id, "bridge-deposits", "confidential"], queryFn: ({ signal }) => getBridgeDeposits(signal), enabled: open, staleTime: 30000 });
  const assets = catalog.data?.assets ?? [];
  const trading = useTradingWallet(open ? tradingWallet?.id : undefined, assets);
  function activityNetwork(name: string) {
    if (!name) return undefined;
    return assets.find(asset => networkName(asset.blockchain) === name)?.blockchain ?? networkFor(name) ??
      ({ "BNB Smart Chain": "bsc", BSC: "bsc", Base: "base", NEAR: "near" } as Record<string, string>)[name];
  }
  const supportedFunding = new Set(fundingAssets(assets).map(a => a.assetId));
  const selectedBalances = tradingWallet ? trading.balance : balances;
  const balanceAssets = tradingWallet ? trading.assets : balances.data?.assets;
  const holdings = (balanceAssets ?? []).filter(b => b.raw !== "0").flatMap(b => {
    const asset = assets.find(a => a.assetId === b.assetId);
    return asset ? [{ ...b, asset }] : [];
  });
  const funding = holdings.filter(b => supportedFunding.has(b.assetId));
  const fundingUsd = funding.reduce((sum, b) => sum.add(new D(b.amount).mul(b.asset.price ?? 0)), new D(0));
  const fundingPriced = funding.every(b => b.asset.price !== undefined && new D(b.asset.price).gt(0));
  const tradingUsdc = balances.data?.assets.find(b => b.assetId === DEFAULT_PAIR.quote.assetId)?.amount;
  const loaded = !!selectedBalances.data && !!catalog.data;
  const hasActiveTransfer = history.data?.operations.some(b => b.legs.some(l => ["ready", "submitting", "submitted", "unknown"].includes(l.state)));
  const transferUnconfirmed = history.data?.operations.some(batch => batch.legs.some(leg => leg.state === "unknown"));
  const transferReady = history.data?.operations.some(batch => batch.legs.some(leg => leg.state === "ready"));
  const hideFunding = history.isSuccess && !hasActiveTransfer && loaded && !balances.error && !catalog.error && supportedFunding.size > 0 && funding.length === 0;
  let portfolioValue = new D(0);
  let unpriced = tradingWallet ? trading.unknown.length : 0;
  let priced = 0;
  for (const balance of balanceAssets ?? []) {
    if (balance.raw === "0") continue;
    const price = markets.data?.assets[balance.assetId]?.price;
    if (price == null || !Number.isFinite(price) || price <= 0) { unpriced += 1; continue; }
    portfolioValue = portfolioValue.add(new D(balance.amount).mul(price));
    priced += 1;
  }
  const activity = [
    ...(trades.data?.trades ?? []).map(trade => { const pair = trade.review.pair ?? DEFAULT_PAIR; const asset = trade.review.side === "buy" ? pair.base : pair.quote; return { id: `trade:${trade.id}`, time: trade.createdAt, asset, symbol: asset.symbol, estimated: true, amount: trade.review.estimatedOutput, processing: ["submitting", "submitted", "unknown"].includes(trade.state), label: `${trade.state === "settled" ? trade.review.side === "buy" ? "Bought" : "Sold" : trade.review.side === "buy" ? "Buy" : "Sell"} ${pair.base.symbol}`, status: trade.state === "failed" ? "Failed or refunded" : trade.state === "unknown" ? "Checking status" : "", network: networkName(asset.blockchain) }; }),
    ...(history.data?.operations ?? []).flatMap(op => op.legs.filter(leg => !["ready", "cancelled"].includes(leg.state)).map(leg => ({ id: `funding:${op.id}:${leg.id}`, time: op.createdAt, asset: DEFAULT_PAIR.quote, symbol: "USDC", estimated: true, processing: ["submitting", "submitted", "unknown"].includes(leg.state), amount: leg.review.estimatedOutput, label: "Transfer to trading", status: ({ submitting: "Processing", submitted: "Processing", unknown: "Checking status", settled: "", failed: "Failed or refunded", ready: "Awaiting confirmation", cancelled: "Cancelled" })[leg.state], network: "NEAR" }))),
    ...(withdrawals.data?.withdrawals ?? []).map(w => ({ id: `withdrawal:${w.id}`, time: w.createdAt, asset: assets.find(a => a.assetId === w.review.originAsset), symbol: w.review.asset, processing: ["submitting", "submitted", "unknown"].includes(w.state), amount: w.review.amount, label: w.state === "settled" ? "Withdrawn" : w.state === "failed" ? "Withdrawal failed" : w.state === "unknown" ? "Checking withdrawal" : "Withdrawing", network: w.review.destinationChain })),
    ...(deposits.data?.deposits ?? []).filter(d => !isAwaitingDeposit(d)).map(d => ({ id: `deposit:${d.id}`, time: d.createdAt, asset: assets.find(a => a.assetId === d.quote.sourceAssetId), symbol: d.quote.asset, processing: ["PROCESSING", "KNOWN_DEPOSIT_TX"].includes(d.status), amount: d.creditedAmount, label: d.status === "SUCCESS" ? "Deposited" : `Deposit · ${depositStatusLabel(d.status)}`, network: d.quote.sourceChain })),
    ...(bridge.data?.deposits ?? []).map((d, i) => { const asset = assets.find(a => a.assetId === d.assetId); return { id: `bridge:${d.chain}:${d.txHash}:${i}`, time: 0, asset, symbol: asset?.symbol ?? "Token", processing: !["COMPLETED", "FAILED"].includes(d.status), amount: new D(d.amount).div(new D(10).pow(d.decimals)).toFixed(), label: d.status === "COMPLETED" ? "Deposited" : d.status === "FAILED" ? "Deposit failed" : "Receiving deposit", network: asset ? networkName(asset.blockchain) : networkName(networkFor(d.chain) ?? d.chain) }; }),
  ].sort((a, b) => b.time - a.time);
  const activityLoading = [history, withdrawals, deposits, bridge, trades].some(q => q.isPending);
  const activityError = [history, withdrawals, deposits, bridge, trades].some(q => q.error);
  const accessRequired = !tradingWallet && balances.error instanceof ConfidentialAccessRequired;
  const balanceFailure = !!(selectedBalances.error || catalog.error);
  const balancesUnavailable = balanceFailure && !loaded;
  const emptyWallet = !tradingWallet && loaded && !balanceFailure && !accessRequired
    && balances.data?.assets.every(balance => balance.raw === "0")
    && [history, withdrawals, deposits, bridge, trades].every(query => query.isSuccess)
    && !history.data?.operations.length && !withdrawals.data?.withdrawals.length
    && !deposits.data?.deposits.length && !bridge.data?.deposits.length && !trades.data?.trades.length;
  const retrying = selectedBalances.isFetching || catalog.isFetching;
  function retryBalances() { void selectedBalances.refetch(); void catalog.refetch(); }
  function action(callback: () => void) { setOpen(false); setSettings(false); callback(); }
  return <Popover key={account.id} open={open} onOpenChange={value => { setOpen(value); if (!value) setSettings(false); }}>
    <PopoverTrigger render={<Button variant="outline" size="sm" className="pl-1.5 [&>[data-slot=avatar]]:size-4.5" aria-label="Open wallet" />}><AccountAvatar seed={seed} size="sm" /><span className="max-w-32 truncate" title={name}>{name}</span>{tradingWallet && <TradingAccountBadge />}</PopoverTrigger>
    <PopoverContent align="end" className="w-[360px] max-w-[calc(100vw-2rem)] max-h-[80dvh] overflow-y-auto gap-4 rounded-[var(--radius-dialog)] [&_[data-slot=popover-header]]:rounded-t-[calc(var(--radius-dialog)-1px)]">
      {settings ? <>
        <PopoverHeader onBack={() => setSettings(false)} backLabel="Back to wallet"><PopoverTitle>Settings</PopoverTitle></PopoverHeader>
        <WalletSettings idOrigin={idOrigin} busy={busy} onSignOut={() => action(onSignOut)} />
      </> : <>
      <PopoverHeader className="py-0 pl-1 [&>div.absolute]:top-1/2 [&>div.absolute]:-translate-y-1/2 [&>div.absolute>[data-slot=button]]:rounded-full" action={<Button variant="ghost" size="icon-sm" className="rounded-full hover:bg-foreground/6 focus-visible:bg-foreground/6" aria-label="Account settings" onClick={() => setSettings(true)}><SettingsFilled /></Button>}>
        {wallets.length && onSelectWallet ? <DropdownMenu modal={false}><DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-8 min-w-0 max-w-full self-start justify-start rounded-full pr-2 pl-1.5 hover:bg-foreground/6 focus-visible:bg-foreground/6 aria-expanded:bg-foreground/6" disabled={busy} aria-label={`Switch account, ${name} selected`} />}>
          <AccountAvatar seed={seed} size="sm" className="data-[size=sm]:size-5" /><span className="truncate">{name}</span>{tradingWallet && <TradingAccountBadge />}<ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
          <WalletAccountMenuItem name={DYA_WALLET_NAMES.main} seed={account.intentsIdentity?.accountId ?? account.id}
            selected={!tradingWallet} onClick={() => onSelectWallet(null)} />
          {wallets.map(wallet => <WalletAccountMenuItem key={wallet.id} name={wallet.name} seed={wallet.id} trading
            selected={wallet.id === tradingWallet?.id} onClick={() => onSelectWallet(wallet.id)} />)}
        </DropdownMenuContent>
        </DropdownMenu> : <div className="flex min-w-0 items-center gap-2"><AccountAvatar seed={seed} size="sm" /><PopoverTitle className="min-w-0 truncate">{name}</PopoverTitle></div>}
      </PopoverHeader>
      {!accessRequired && !balancesUnavailable && <div className="space-y-1" aria-label="Portfolio value"><p className="text-xs text-muted-foreground">Total balance</p><MeasuredSkeleton loading={!loaded || (!markets.data && markets.isPending)} label="Loading total balance"><p className="text-4xl font-semibold tabular-nums">{loaded && unpriced > 0 && priced === 0 ? "-" : <FormattedNumber value={!loaded ? "1000" : portfolioValue.toFixed()} format="currency" />}</p></MeasuredSkeleton>{unpriced > 0 && <p className="text-muted-foreground">{priced > 0 ? "Partial valuation" : "Prices unavailable"}</p>}{markets.error && markets.data && <p className="text-muted-foreground">Price updates delayed</p>}</div>}
      {accessRequired ? <ConfidentialAccess key={account.id} panel /> : <>
      {emptyWallet ? <section className="space-y-4 border-t border-border pt-4" aria-label="Get started">
        <div className="space-y-1"><h3 className="font-medium">Add funds to get started</h3><p className="text-sm text-muted-foreground">Deposit assets, then move them to Trading.</p></div>
        <Button className="w-full" onClick={() => action(onDeposit)}><ArrowDownLeft />Deposit</Button>
      </section> : <>
      {balancesUnavailable ? <section className="flex flex-col items-center gap-3 py-6 text-center" aria-label="Balance connection error">
        <WifiOff className="size-6 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1" role="status"><h3>Couldn’t load balances</h3><p className="text-sm text-muted-foreground">Please try again in a moment.</p></div>
        <Button variant="outline" disabled={retrying} onClick={retryBalances}>{retrying ? "Retrying…" : "Try again"}</Button>
      </section> : <>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => action(onDeposit)}><ArrowDownLeft />Deposit</Button>
        <Button variant="outline" disabled={!!tradingWallet && (tradeAccess.isPending || tradeAccess.isError || tradeAccess.data.enabled)} onClick={() => action(onWithdraw)}><ArrowUpRight />Withdraw</Button>
      </div>
      {balanceFailure && <div className="flex items-center justify-between gap-2" role="status"><p className="text-sm text-muted-foreground">Updates delayed · last known balances</p><Button variant="ghost" size="sm" disabled={retrying} onClick={retryBalances}>{retrying ? "Retrying…" : "Retry"}</Button></div>}
      {!tradingWallet && <section aria-label="Trading and Funding balances" className="divide-y divide-border rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-4 p-3"><span>Available to trade</span><MeasuredSkeleton loading={!loaded} label="Loading trading balance"><p title={tradingUsdc === undefined ? undefined : `${tradingUsdc} USDC`} aria-label={!loaded ? undefined : tradingUsdc === undefined ? "USDC trading balance unavailable" : `${tradingUsdc} USDC trading balance`}>{loaded && tradingUsdc === undefined ? "-" : <FormattedNumber value={loaded ? tradingUsdc : "1000"} format="currency" />}</p></MeasuredSkeleton></div>
        {!hideFunding && <div className="space-y-2 p-3"><div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">In Funding</span><MeasuredSkeleton loading={!loaded} label="Loading funding balance"><p className="text-muted-foreground">{!loaded || fundingPriced ? <FormattedNumber value={loaded ? fundingUsd.toFixed() : "1000"} format="currency" estimated /> : "USD estimate unavailable"}</p></MeasuredSkeleton></div>
          {hasActiveTransfer && <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">{!transferUnconfirmed && !transferReady && <LoaderCircle className="size-3" aria-hidden="true" />}{transferUnconfirmed ? "Transfer unconfirmed" : transferReady ? "Awaiting confirmation" : "Moving funds to Trading"}</p>}
          {history.error && <p role="status" className="text-xs text-muted-foreground">Transfer status unavailable</p>}
          <div className="flex justify-end"><Tooltip><TooltipTrigger render={<Button variant="link" size="xs" className="h-auto p-0" disabled={!loaded || !!balances.error || !!catalog.error || (!funding.length && !hasActiveTransfer)} onClick={() => action(onFunding)} />}>{hasActiveTransfer ? "View transfer" : "Move funds"}<ArrowRight className="size-3" /></TooltipTrigger><TooltipContent className="max-w-xs">{hasActiveTransfer ? "Review the status of your Funding to Trading transfer." : "Move supported Funding assets to Trading. Review the conversion and fees before confirming."}</TooltipContent></Tooltip></div>
        </div>}
      </section>}
      </>}
      <Tabs value={tab} onValueChange={value => setTab(String(value))}>
        <TabsList variant="labels" aria-label="Wallet contents"><TabsTrigger value="assets">Assets</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList>
        <TabsContent value="assets" className="space-y-3">
          {!loaded || holdings.length ? <WalletSection aria-label="Assets"><WalletSectionContent><WalletAssets loading={!loaded} holdings={holdings} catalog={assets} networks={catalog.data?.networks} limit={5} /></WalletSectionContent></WalletSection> : <WalletSectionEmpty>No assets yet</WalletSectionEmpty>}
          {!tradingWallet && assetsUrl && <a className={buttonVariants({ variant: "outline" })} href={assetsUrl} target="_blank" rel="noopener noreferrer">View all assets<ArrowRight /></a>}
        </TabsContent>
        <TabsContent value="activity" className="space-y-3">{tradingWallet ? <WalletActivity accountId={account.id} source={trading.activity} limit={5} hideHeading /> : <>{!activityLoading && !activityError && !activity.length ? <WalletSectionEmpty>No activity yet</WalletSectionEmpty> : <WalletSection aria-label="Recent Activity"><WalletSectionContent><div className="divide-y divide-foreground/10">{activity.slice(0, 5).map(entry => <WalletActivityRow key={entry.id} className="px-3 py-3" title={entry.label} subtitle={<>{"status" in entry && !!entry.status && <>{entry.status} · </>}{!!entry.time && <RelativeTime timestamp={entry.time} />}</>} icon={entry.asset ? <AssetMark asset={entry.asset} size={36} processing={entry.processing} network={activityNetwork(entry.network)} /> : activityNetwork(entry.network) ? <NetworkMark network={activityNetwork(entry.network)!} size={36} /> : <Wallet className="size-9 shrink-0" />} amount={<FormattedNumber className="text-sm font-medium" value={entry.amount} symbol={entry.symbol} fractionDigits={["USDC", "USDT", "DAI"].includes(entry.symbol) ? 2 : undefined} estimated={"estimated" in entry && entry.estimated === true} exactTooltip aria-label={"estimated" in entry && entry.estimated ? "Estimated received amount" : undefined} title={entry.amount === undefined ? undefined : `${entry.amount} ${entry.symbol}${"estimated" in entry && entry.estimated ? " (estimated)" : ""}`} />} />)}{activityLoading && !activity.length && <WalletActivityRow loading className="px-3 py-3" title="Activity" subtitle="Just now" icon={<Wallet className="size-9" />} amount={<FormattedNumber value="1000" symbol="USDC" />} />}</div>{activityLoading && activity.length > 0 && <p role="status" className="text-xs text-muted-foreground">Loading more activity…</p>}{activityError && <p className="text-muted-foreground">Some activity is unavailable.</p>}</WalletSectionContent></WalletSection>}<div>{activityUrl ? <a className={buttonVariants({ variant: "outline" })} href={activityUrl} target="_blank" rel="noopener noreferrer">View all activity<ArrowRight /></a> : <Button variant="outline" onClick={() => action(onActivity)}>View all activity<ArrowRight /></Button>}</div></>}</TabsContent>
      </Tabs>
      </>}
      </>}
      </>}
    </PopoverContent>
  </Popover>;
}
