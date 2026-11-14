"use client";
import { tokenAllowed } from "@dya/wallet-contracts/src/domain/token-registry";
import { networkAllowed } from "@dya/wallet-contracts/src/domain/networks";
import { BrandLogo } from "@dya/ui/components/brand-logo";
import { DYA_BRAND, DYA_WALLET_NAMES, TOAST_MESSAGES } from "@dya/config";
import { FormattedNumber } from "@dya/ui/components/formatted-number";

import { TradingSendPolicy } from "./trading-send-policy";
import { AccountWelcome } from "./account-welcome";
import { AccountNameForm, AccountSecurityIcon } from "./account-name-form";
import { toast } from "@dya/ui/lib/toast";
import { useCallback, useEffect, useRef, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { ArrowDownLeft, ArrowUpRight, LoaderCircle, ScanFace, TriangleAlert } from "@dya/ui/icons";
import { Button } from "@dya/ui/components/button";
import { AppLoadingScreen } from "@dya/ui/components/app-loading-screen";
import { AuthBrandCard } from "@dya/ui/components/auth-brand-card";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { Input } from "@dya/ui/components/input";
import { Label } from "@dya/ui/components/label";
import { LabeledSeparator } from "@dya/ui/components/separator";
import { D } from "@dya/wallet-contracts/src/domain/decimal";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { WalletQueryProvider } from "@dya/wallet-ui/components/wallet-query-provider";
import { useCatalogQuery, useWalletSessionQuery } from "@dya/wallet-ui/hooks/use-wallet-queries";
import { balanceQueryKey, useBalanceQuery } from "@dya/wallet-ui/components/near/use-live-balances";
import { ConfidentialAccessRequired } from "@dya/wallet-contracts/src/domain/confidential-access-error";
import { logout, loginOptions as getLoginOptions, registrationOptionsRequest as getRegistrationOptions, verifyLogin as loginPasskey, verifyRegistration as registerPasskey } from "@dya/wallet-ui/lib/near/http/account-client";
import { prepareConfidentialAccess, unlockConfidentialAccessWithBalances } from "@dya/wallet-ui/lib/near/http/confidential-client";
import { WalletSection, WalletSectionHeader, WalletSectionContent } from "@dya/wallet-ui/components/wallet-section";
import { SignOutDialog } from "@dya/wallet-ui/components/sign-out-dialog";
import { WalletAssets } from "@dya/wallet-ui/components/wallet-assets";
import { WalletProgress } from "./wallet-progress";
import { WalletActivity } from "./wallet-activity";
import { WalletPageHeader } from "./wallet-page-header";
import { WalletRecovery } from "./wallet-recovery";
import { TradingSetup } from "./trading-setup";
import { useTradingWallet } from "./use-trading-wallet";
import { useStoredSelection } from "@dya/wallet-ui/hooks/use-stored-selection";
import { WalletTransfer } from "./wallet-transfer";

import { approveTradingWithdrawal, prepareTradingWithdrawalApproval, estimateTradingWithdrawal, readTradingWithdrawal } from "../lib/outlayer-client";
import type { WithdrawalSource } from "@dya/wallet-ui/components/near/withdrawal-form";

const baseUsdc = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

type WalletView = "create" | "home" | "assets" | "activity" | "recovery" | "policy";
export function WalletDashboard({ view = "home", tradingSetupEnabled = false, tradingAccountId, createNew = false }: { view?: WalletView; tradingSetupEnabled?: boolean;tradingAccountId?:string;createNew?:boolean }) {
  return <WalletQueryProvider><WalletDashboardContent view={view} tradingSetupEnabled={tradingSetupEnabled} tradingAccountId={tradingAccountId} createNew={createNew} /></WalletQueryProvider>;
}
function WalletDashboardContent({ view, tradingSetupEnabled,tradingAccountId,createNew }: { view: WalletView; tradingSetupEnabled: boolean;tradingAccountId?:string;createNew?:boolean }) {
  const sessionQuery = useWalletSessionQuery();
  const [revealed, setRevealed] = useState(false);
  const reveal = useCallback(() => setRevealed(true), []);
  return <>
    {!revealed && <AppLoadingScreen active={sessionQuery.isPending} label="Loading account" onExitComplete={reveal} />}
    <div inert={!revealed || undefined} aria-hidden={!revealed || undefined}>
      <WalletDashboardAccount key={sessionQuery.data?.account?.id ?? "signed-out"} sessionQuery={sessionQuery} view={view} tradingSetupEnabled={tradingSetupEnabled} tradingAccountId={tradingAccountId} createNew={createNew} />
    </div>
  </>;
}
function WalletDashboardAccount({ sessionQuery, view, tradingSetupEnabled,tradingAccountId,createNew }: { sessionQuery: ReturnType<typeof useWalletSessionQuery>; view: WalletView; tradingSetupEnabled: boolean;tradingAccountId?:string;createNew?:boolean }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const client = useQueryClient();
  const session = sessionQuery.data ?? null;
  const tradingWallets=session?.account?.tradingWallets ?? (session?.account?.tradingWallet ? [{...session.account.tradingWallet,name:DYA_WALLET_NAMES.legacyTrading}] : []);
  const [selectedWalletId, storeWalletSelection] = useStoredSelection(session?.account?.id ? `dya:id:selected-wallet:${session.account.id}` : null);
  function selectWallet(id: string | null) {
    setAction(null);
    storeWalletSelection(id);
  }
  const selectedTradingWallet = tradingSetupEnabled ? tradingWallets.find(wallet => wallet.id === selectedWalletId) : undefined;
  const showTrading = (view === "home" || view === "assets" || view === "activity") && !!selectedTradingWallet;
  const loading = sessionQuery.isPending;
  const accountUnavailable = !session || sessionQuery.isError;
  const accountId = session?.account?.id ?? null;
  const localRecovery = !!session?.account?.localRecovery;
  const [recovery, setRecovery] = useState<"enroll" | "recover" | null>(null);
  const restoreRecoveryFocus = useRef(false);
  const mainBalance = useBalanceQuery(localRecovery ? null : accountId);
  const catalogQuery = useCatalogQuery(!!accountId && !localRecovery);
  const catalog = catalogQuery.data?.assets ?? [];
  const trading = useTradingWallet(showTrading && !localRecovery ? selectedTradingWallet?.id : undefined, catalog);
  const withdrawalSource: WithdrawalSource | undefined = showTrading && selectedTradingWallet ? {
    assetId: baseUsdc,
    balances: { ...trading.balance, data: trading.assets ? { assets: trading.assets } : undefined },
    async prepare(input) {
      if (!("originAssetId" in input) || input.originAssetId !== baseUsdc || input.destinationAssetId !== baseUsdc) {
        throw new Error("Choose USDC on Base.");
      }
      const estimate = await estimateTradingWithdrawal(selectedTradingWallet.id, input.wallet, new D(input.amount).mul(1_000_000).toFixed(0));
      const { options } = await prepareTradingWithdrawalApproval(selectedTradingWallet.id, estimate.id);
      return { options, id: estimate.id, review: { amount: input.amount, asset: "USDC", destinationWallet: input.wallet,
        expectedReceive: new D(estimate.estimatedRawAmount).div(1_000_000).toFixed(), deadline: estimate.deadline } };
    },
    submit(assertion, id) {
      if (!id) throw new Error("Trading withdrawal review unavailable.");
      return approveTradingWithdrawal(selectedTradingWallet.id, id, assertion);
    },
    status(id) { return readTradingWithdrawal(selectedTradingWallet.id, id); },
    onUpdated() { void trading.balance.refetch(); void trading.activity.refetch(); },
  } : undefined;
  const balanceQuery = showTrading ? trading.balance : mainBalance;
  const locked = balanceQuery.error instanceof ConfidentialAccessRequired;
  const balances = showTrading ? (trading.assets ? { assets: trading.assets } : null) : locked ? null : mainBalance.data ?? null;
  const [welcoming, setWelcoming] = useState(false);
  const [naming, setNaming] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [actionError, setError] = useState("");
  const [action, setAction] = useState<"receive" | "send" | null>(null);
  const error = actionError || (sessionQuery.isError ? "Couldn’t load your account. Try again." : "") || (catalogQuery.isError ? "Supported assets are unavailable. Retry to update them." : "") || (!locked && balanceQuery.isError ? balances ? "Updates delayed · showing last known balances." : "Couldn’t load balances. Try again." : "");
  async function run(label: string, task: () => Promise<void>) {
    if (!mounted.current) return;
    setBusy(label); setError("");
    try { await task(); } catch (e) {
      if (mounted.current) {
        if (e && typeof e === "object" && "name" in e && e.name === "NotAllowedError") toast(TOAST_MESSAGES.confirmationCancelled);
        else setError(e instanceof Error ? e.message : "Could not complete this request.");
      }
    }
    finally { if (mounted.current) setBusy(""); }
  }
  async function signIn(create: boolean, name?: string) {
    if (create && !name) { setWelcoming(true); setError(""); return; }
    await run(create ? "Creating…" : "Signing in…", async () => {
      const options = create ? await getRegistrationOptions(name!) : await getLoginOptions();
      if (!mounted.current) return;
      const assertion = create
        ? await startRegistration({ optionsJSON: options as Awaited<ReturnType<typeof getRegistrationOptions>> })
        : await startAuthentication({ optionsJSON: options as Awaited<ReturnType<typeof getLoginOptions>> });
      if (!mounted.current) return;
      const { session: signedIn } = create
        ? await registerPasskey(assertion as Awaited<ReturnType<typeof startRegistration>>)
        : await loginPasskey(assertion as Awaited<ReturnType<typeof startAuthentication>>);
      if (!mounted.current) return;
      await client.cancelQueries({ queryKey: ["near", "session"] });
      if (!mounted.current) return;
      client.setQueryData(["near", "session"], signedIn);
      setNaming(false);
    });
  }
  async function refresh() {
    if (!mounted.current) return;
    setError("");
    await Promise.all([balanceQuery.refetch(), catalogQuery.refetch()]);
  }
  async function unlock() {
    await run("Confirming…", async () => {
      const prepared = await prepareConfidentialAccess();
      if (!mounted.current) return;
      const assertion = await startAuthentication({ optionsJSON: prepared.options });
      if (!mounted.current) return;
      const { balances: unlocked } = await unlockConfidentialAccessWithBalances(assertion);
      if (!mounted.current) return;
      const balanceKey = balanceQueryKey(accountId);
      if (unlocked) {
        await client.cancelQueries({ queryKey: balanceKey });
        if (!mounted.current) return;
        client.setQueryData(balanceKey, unlocked);
      }
      await client.invalidateQueries({ queryKey: ["near", "account", accountId], predicate: query => !unlocked || query.queryHash !== hashKey(balanceKey) });
    });
  }
  const holdings = balances?.assets.filter(asset => asset.raw !== "0") ?? [];
  const mainInternalAssets = catalog.filter(asset =>
    holdings.some(holding => holding.assetId === asset.assetId && new D(holding.raw).gt(0)) &&
    tokenAllowed(asset, catalogQuery.data?.tokens?.find(token => token.id === asset.assetId), "withdrawals") &&
    networkAllowed(catalogQuery.data?.networks?.find(network => network.id === asset.blockchain), "withdrawals"));

  const valued = holdings.map(asset => ({ asset, price: catalog.find(item => item.assetId === asset.assetId)?.price }));
  const pricedHoldings = valued.filter(item => item.price != null && new D(item.price).gt(0));
  const unpriced = pricedHoldings.length < valued.length || (showTrading && trading.unknown.length > 0);
  const total = pricedHoldings.reduce((sum, item) => sum.add(new D(item.asset.amount).mul(item.price ?? 0)), new D(0));
  const mainHoldings = mainBalance.data?.assets.filter(asset => asset.raw !== "0") ?? [];
  const mainPrices = mainHoldings.flatMap(asset => {
    const price = catalog.find(item => item.assetId === asset.assetId)?.price;
    return price != null && new D(price).gt(0) ? [new D(asset.amount).mul(price)] : [];
  });
  const mainValue = mainBalance.data && !mainBalance.isError && (!mainHoldings.length || mainPrices.length)
    ? mainPrices.reduce((sum, value) => sum.add(value), new D(0)).toFixed() : null;
  const portfolioValue = balances && !balanceQuery.isError && (!unpriced || pricedHoldings.length > 0) ? total.toFixed() : null;
  const renderPageHeader = (onBack?: () => void) => session?.account && <WalletPageHeader stayOnPage={view === "home"} onSelectWallet={selectWallet} selectedWallet={showTrading || (view === "policy" && selectedTradingWallet) ? "trading" : "standard"} tradingWallet={selectedTradingWallet} tradingWallets={tradingWallets} tradingSetups={session.account.tradingSetups} accountValue={showTrading ? mainValue : portfolioValue} tradingAccountValue={showTrading ? portfolioValue : null} tradingSetupEnabled={tradingSetupEnabled} title={view === "home" ? undefined : view === "create" ? "Create account" : view === "assets" ? "Assets" : view === "activity" ? "Activity" : view === "policy" ? "Policy" : "Recovery wallet"} onBack={onBack} backHref={onBack || view === "home" ? undefined : "/"} accountName={session.account.name} avatarSeed={session.account.intentsIdentity?.accountId ?? session.account.id} disabled={!!busy} onSignOut={() => { setError(""); setSignOutOpen(true); }} />;
  return <main className="mx-auto flex min-h-dvh w-full max-lg:flex-col">
    <AuthBrandCard brandName={DYA_BRAND.idName} title={<>Your assets.<br />Your privacy.</>} homeHref="/" />
    <section className="flex min-w-0 flex-1 flex-col py-4 lg:ml-[calc(45vw+1rem)] lg:py-6" aria-label="Wallet dashboard"><div className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 sm:px-6 ${session?.account ? "max-w-2xl" : "max-w-[376px] justify-center"}`}>
      {session?.account && !accountUnavailable && !action && !recovery && view !== "create" && renderPageHeader()}
      {error && session && !accountUnavailable && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {recovery ? <WalletRecovery provider={session?.recoveryMode === "provider" && !localRecovery} mode={recovery} recoveryId={session?.account?.id} onCancel={() => { restoreRecoveryFocus.current = !accountId; setRecovery(null); }} onComplete={async () => { await client.cancelQueries({ queryKey: ["near", "account"] }); client.removeQueries({ queryKey: ["near", "account"] }); await sessionQuery.refetch(); setRecovery(null); }} /> : loading ? <WalletProgress title="Loading account…" /> : accountUnavailable ? <div className="flex flex-col items-center gap-4 text-center" role="alert"><TriangleAlert className="size-10 text-muted-foreground" aria-hidden="true" /><h1>Unable to load your account</h1><Button variant="outline" disabled={sessionQuery.isFetching} onClick={() => void sessionQuery.refetch()}>{sessionQuery.isFetching && <LoaderCircle  />}{sessionQuery.isFetching ? "Retrying…" : "Retry"}</Button></div> : !session.account ? welcoming ? <div className="mx-auto w-full max-w-[328px] space-y-6"><div className="flex flex-col items-center gap-4 text-center"><BrandLogo size={16} name={DYA_BRAND.idName} /><h1>Welcome to {DYA_BRAND.idName}</h1></div><AccountWelcome onContinue={() => { setWelcoming(false); setNaming(true); }} /></div> : naming ? <div className="mx-auto w-full max-w-[328px] space-y-6"><div className="flex flex-col items-center gap-4 text-center"><AccountSecurityIcon /><h1>Name your account</h1></div><AccountNameForm busy={!!busy} onSubmit={name => void signIn(true, name)} /></div> : (busy === "Signing in…" || busy === "Creating…") ? <WalletProgress title={busy === "Creating…" ? "Creating account…" : "Signing in…"} description="Check your device for a confirmation prompt." /> : <div className="mx-auto w-full max-w-[328px] space-y-6"><div className="flex flex-col items-center gap-4 text-center"><BrandLogo size={16} name={DYA_BRAND.idName} /><h1>Get started</h1><p className="text-muted-foreground">Sign in to manage your {DYA_BRAND.accountName}.</p></div><div className="space-y-4"><Button className="w-full" disabled={!!busy} onClick={() => void signIn(false)}>{busy === "Signing in…" ? <LoaderCircle  /> : <ScanFace />}{busy === "Signing in…" ? busy : "Sign in"}</Button><LabeledSeparator>First time here?</LabeledSeparator><Button className="w-full" variant="outline" disabled={!!busy} onClick={() => void signIn(true)}>{busy === "Creating…" && <LoaderCircle  />}{busy === "Creating…" ? busy : "Create account"}</Button>{(session.recoveryMode === "local_test" || session.recoveryMode === "provider") && <><p className="text-center text-sm text-muted-foreground">Trouble signing in? <Button variant="link" className="h-auto p-0" ref={node => { if (node && restoreRecoveryFocus.current) { restoreRecoveryFocus.current = false; node.focus(); } }} onClick={() => setRecovery("recover")}>Recover</Button></p></>}</div></div> : <>
        {view === "policy" ? selectedTradingWallet && !localRecovery
          ? <TradingSendPolicy key={selectedTradingWallet.id} walletId={selectedTradingWallet.id} settings onBusyChange={pending => setBusy(pending ? "Updating policy…" : "")} />
          : <p className="text-muted-foreground">Select a Trading account to manage its policy.</p>
        : view === "create" ? <TradingSetup onOpenAccount={selectWallet} renderHeader={renderPageHeader} accountId={tradingAccountId} createNew={createNew}/> : view === "recovery" ? localRecovery ? <section aria-label="Recovery" className="space-y-3"><p className="text-sm text-muted-foreground">Local test account. Live balances, deposits, and transactions are disabled.</p>{session.account.recoveryWallet ? <><p className="break-all text-sm">Recovery wallet: {session.account.recoveryWallet.address}</p><p className="text-sm">Enrolled for local testing. Sign out to test account recovery.</p><Label htmlFor="account-recovery-id">Recovery ID</Label><Input id="account-recovery-id" readOnly value={session.account.id} /></> : <Button onClick={() => setRecovery("enroll")}>Add recovery wallet</Button>}</section> : session.recoveryMode === "provider" ? <section aria-label="Recovery" className="space-y-3">{session.account.providerRecovery?.controller ? <><p className="break-all text-sm">Verified recovery wallet: {session.account.providerRecovery.controller.address}</p><p className="text-sm text-muted-foreground">Recover by connecting this wallet. No recovery ID is needed.</p></> : <Button onClick={() => setRecovery("enroll")}>{session.account.providerRecovery?.phase ? "Resume recovery enrollment" : "Add recovery wallet"}</Button>}</section> : <p className="text-muted-foreground">Recovery wallet setup is unavailable.</p> : localRecovery ? <p className="text-sm text-muted-foreground">Local test account. Live balances, deposits, and transactions are disabled.</p> : action ? <WalletTransfer key={`${selectedTradingWallet?.id ?? "main"}:${action}`} direction={action} trading={showTrading} mainInternalAssets={mainInternalAssets} internalBalances={holdings} internalAccounts={[{ id: "main", name: DYA_WALLET_NAMES.main, avatarSeed: session.account.intentsIdentity?.accountId ?? session.account.id }, ...tradingWallets]} withdrawalSource={withdrawalSource} avatarSeed={showTrading ? selectedTradingWallet?.id : session.account.intentsIdentity?.accountId ?? session.account.id} accountId={showTrading ? selectedTradingWallet!.id : session.account.id} onBack={() => setAction(null)} onUpdated={() => { void refresh(); if (showTrading) { void trading.activity.refetch(); void trading.balance.refetch(); } }} onSignOut={() => { setError(""); setSignOutOpen(true); }} /> : <>
          {(view === "home" || locked) && <section className="space-y-4" aria-label="Confidential balances"><div className="flex items-center justify-between gap-4"><h2>Balance</h2>{((balanceQuery.isError && !locked) || catalogQuery.isError) && <Button variant="outline" size="sm" disabled={balanceQuery.isFetching || catalogQuery.isFetching || !!busy} onClick={() => void refresh()}>{balanceQuery.isFetching && <LoaderCircle  />}Retry</Button>}</div>{locked ? <><p className="text-muted-foreground">Confirm access to view your balances.</p><Button disabled={!!busy} onClick={() => void unlock()}>{busy ? <LoaderCircle  /> : <ScanFace />}{busy || "Unlock balances"}</Button></> : <><p aria-label="Estimated portfolio value" className="text-3xl tabular-nums">{balances && (!unpriced || pricedHoldings.length > 0) ? <FormattedNumber value={total.toFixed()} format="currency" /> : "-"}</p>{unpriced && <p className="text-sm text-muted-foreground">Some prices unavailable</p>}<div className="flex gap-2"><Button disabled={!catalog.length || !!busy} onClick={() => setAction("receive")}><ArrowDownLeft />Receive</Button><Button variant="outline" disabled={!!busy || (!showTrading && (!balances || !holdings.length || balanceQuery.isError))} onClick={() => setAction("send")}><ArrowUpRight />Send</Button></div></> }</section>}
          {view !== "activity" && !locked && <WalletSection aria-label="Assets">{view !== "assets" && <WalletSectionHeader href={view === "home" && holdings.length ? "/assets" : undefined}>Assets</WalletSectionHeader>}<WalletSectionContent>{!balances ? <p role="status">{balanceQuery.isPending ? "Loading balances…" : "Balances unavailable."}</p> : !holdings.length && (!showTrading || !trading.unknown.length) ? <p className="text-muted-foreground">No funds yet. Receive assets to get started.</p> : <WalletAssets holdings={holdings} catalog={catalog} networks={catalogQuery.data?.networks} limit={view === "home" ? 5 : undefined} pageSize={view === "assets" ? 20 : undefined} />}{showTrading && trading.unknown.map(asset => <p key={asset.token} className="break-all text-sm">{asset.token} · {asset.balance} base units</p>)}</WalletSectionContent></WalletSection>}
          {view !== "assets" && !locked && !balanceQuery.isPending && <WalletActivity key={showTrading ? selectedTradingWallet?.id : accountId} source={showTrading ? trading.activity : undefined} onReceive={() => setAction("receive")} receiveDisabled={!catalog.length || !!busy} accountId={session.account.id} limit={view === "home" ? 5 : undefined} pageSize={view === "activity" ? 20 : undefined} href={view === "home" ? "/activity" : undefined} hideHeading={view === "activity"} groupByDay={view === "activity"} />}

        </>}
      </>}
    </div></section>
    <SignOutDialog open={signOutOpen && !accountUnavailable} onOpenChange={setSignOutOpen} busy={!!busy} error={actionError} onConfirm={() => void run("Signing out…", async () => {
      await logout();
      const tradingQueries = { predicate: (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === "id" && typeof query.queryKey[1] === "string" && query.queryKey[1].startsWith("trading-") };
      await client.cancelQueries(tradingQueries);
      client.removeQueries(tradingQueries);
      if (!mounted.current) return;
      await client.cancelQueries({ queryKey: ["near", "account"] });
      if (!mounted.current) return;
      client.removeQueries({ queryKey: ["near", "account"] });
      await client.cancelQueries({ queryKey: ["near", "session"] });
      if (!mounted.current) return;
      client.setQueryData(["near", "session"], session ? { ...session, account: null } : null);
      setAction(null); setSignOutOpen(false);
    })} />
  </main>;
}
