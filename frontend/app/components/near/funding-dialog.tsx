"use client";
import { FundingTradingGuide } from "@dya/wallet-ui/components/funding-trading-guide";
import { isConfirmationCancelled } from "@dya/ui/lib/is-confirmation-cancelled";
import { toast } from "@dya/ui/lib/toast";
import { useHapticFeedback } from "@dya/ui/hooks/use-haptic-feedback";
import { DYA_BRAND, TOAST_MESSAGES } from "@dya/config";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { TransactionStatus, TransactionStatusBody } from "./transaction-status";
import { ArrowRight, CircleAlert, CircleCheck, CircleX, LoaderCircle, TriangleAlert } from "@dya/ui/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startAuthentication } from "@dya/wallet-sdk";
import { useBalanceQuery } from "./use-live-balances";
import { useCatalogQuery } from "@dya/wallet-ui/hooks/use-wallet-queries";
import { authorizeFunding, cancelFunding, fundingHistory, fundingStatus, prepareFunding, submitFunding } from "@/lib/near/http/funding-conversions-client";
import { fundingAssets } from "@/lib/near/domain/funding-balances";
import type { FundingBatch } from "@/lib/near/http/schemas/funding-conversions";
import { DEFAULT_PAIR, quantityRaw } from "@/lib/near/domain/catalog";
import { D } from "@/lib/near/domain/decimal";
import { networkName } from "@/lib/near/domain/deposit-assets";
import { DetailsDisclosure } from "@dya/ui/components/details-disclosure";
import { Avatar, AvatarGroup, AvatarGroupCount } from "@dya/ui/components/avatar";
import { NetworkMark } from "./network-mark";
import { Button } from "@dya/ui/components/button";
import { Input } from "@dya/ui/components/input";
import { Label } from "@dya/ui/components/label";
import { Badge } from "@dya/ui/components/badge";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { DialogDrawerHeader, DialogDrawerTitle, DialogDrawerDescription } from "@dya/ui/components/dialog-drawer";
import { AssetMark } from "./asset-mark";
import { Checkbox } from "@dya/ui/components/checkbox";
import { ConfidentialAccess } from "./confidential-access";
import { ConfidentialAccessRequired } from "@/lib/near/domain/confidential-access-error";
const unresolved = (b: FundingBatch) => b.legs.some(l => ["submitting", "submitted", "unknown"].includes(l.state));
const labels = { ready: "Awaiting confirmation", submitting: "Submitting", submitted: "Processing", unknown: "Checking outcome", settled: "Converted", failed: "Failed or refunded", cancelled: "Not submitted" };
function FundingRoute({ networks }: { networks: string[] }) {
  return <div className="grid w-full grid-cols-[1fr_auto_1fr] items-start gap-3" aria-label="Funding to trading">
            <div className="flex min-w-0 flex-col items-center gap-2"><AvatarGroup aria-label="Selected funding networks">{networks.slice(0, 4).map(network => <Avatar key={network} className="items-center justify-center after:hidden" role="img" aria-label={networkName(network)}><NetworkMark network={network} size={32} /></Avatar>)}{networks.length > 4 && <AvatarGroupCount>+{networks.length - 4}</AvatarGroupCount>}</AvatarGroup><p className="text-sm text-muted-foreground">Funding</p></div>
            <span className="mt-1.5 flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true"><ArrowRight className="size-3.5" /></span>
            <div className="flex flex-col items-center gap-2"><Avatar className="items-center justify-center after:hidden" role="img" aria-label="Trading balance on NEAR"><NetworkMark network="near" size={32} /></Avatar><p className="text-sm text-muted-foreground">Trading</p></div>
          </div>;
}
export function FundingDialog({ accountId, onComplete, onDetails }: { accountId: string; onComplete: () => void; onDetails?: () => void }) {
  const feedback = useHapticFeedback();
  const [guideStep, setGuideStep] = useState(0);
  const guideKey = `dya:funding-trading-guide:v1:${accountId}`;
  const [guideDismissed, setGuideDismissed] = useState(() => { try { return localStorage.getItem(guideKey) === "seen"; } catch { return false; } });
  function dismissGuide() { setGuideDismissed(true); try { localStorage.setItem(guideKey, "seen"); } catch { /* Keep the flow usable without storage. */ } }

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const client = useQueryClient();
  const balances = useBalanceQuery(accountId);
  const catalog = useCatalogQuery();
  const history = useQuery({ queryKey: ["near", "account", accountId, "funding", "confidential"], queryFn: async () => {
    const data = await fundingHistory();
    for (const batch of data.operations.filter(unresolved)) {
      const { operation } = await fundingStatus(batch.id);
      data.operations = data.operations.map(b => b.id === operation.id ? operation : b);
    }
    return data;
  }, refetchInterval: 5000, retry: false });
  const [local, setLocal] = useState<FundingBatch | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const [editingAsset, setEditingAsset] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [quoteError, setQuoteError] = useState(false);
  const [progress, setProgress] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const stored = local ? history.data?.operations.find(b => b.id === local.id) : history.data?.operations.find(b => unresolved(b) || b.legs.some(l => l.state === "ready"));
  // Keep a resumed operation selected when polling moves it out of the active list.
  if (!local && stored) setLocal(stored);
  const operation = stored && (!local || stored.updatedAt >= local.updatedAt) ? stored : local;
  const tradingAvailable = catalog.data?.assets.some(a => a.assetId === DEFAULT_PAIR.quote.assetId && a.blockchain === "near" && a.decimals === DEFAULT_PAIR.quote.decimals);
  const eligible = tradingAvailable ? fundingAssets(catalog.data!.assets) : [];
  const funded = eligible.flatMap(asset => { const b = balances.data?.assets.find(b => b.assetId === asset.assetId && b.raw !== "0"); return b ? [{ ...b, asset }] : []; });
  const inputErrors = new Map<string, string>();
  for (const balance of funded) {
    const amount = amounts[balance.assetId] ?? balance.amount;
    if (excluded[balance.assetId] || !amount || new D(amount).isZero()) continue;
    if (new D(amount).gt(balance.amount)) { inputErrors.set(balance.assetId, "Insufficient balance"); continue; }
    try { quantityRaw(amount, balance.asset.decimals); }
    catch { inputErrors.set(balance.assetId, "Invalid amount"); }
  }
  const selectedFunding = funded.filter(balance => !excluded[balance.assetId] && new D((amounts[balance.assetId] ?? balance.amount) || "0").gt(0));
  const networks = [...new Set(selectedFunding.map(balance => balance.asset.blockchain))];
  const pricedSelection = !inputErrors.size && selectedFunding.every(balance => balance.asset.price !== undefined && new D(balance.asset.price).gt(0));
  const sourceValue = pricedSelection ? selectedFunding.reduce((sum, balance) => sum.add(new D(amounts[balance.assetId] ?? balance.amount).mul(balance.asset.price!)), new D(0)) : null;
  const insufficientBalance = [...inputErrors.values()].includes("Insufficient balance");
  const ready = !!tradingAvailable && !!balances.data && !!catalog.data && !!history.data && !balances.error && !catalog.error && !history.error;
  const expired = !!operation && !(Date.parse(operation.expiresAt) > now);
  const refresh = useCallback(async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["near", "account", accountId, "funding"] }), client.invalidateQueries({ queryKey: ["near", "account", accountId, "balances"] })]);
  }, [client, accountId]);
  // Settlement/refunds can occur after the dialog is reopened, or partially.
  const settledLegs = operation?.legs.filter(l => l.state === "settled" || l.state === "failed").length ?? 0;
  useEffect(() => { if (settledLegs) void client.invalidateQueries({ queryKey: ["near", "account", accountId, "balances"] }); }, [settledLegs, client, accountId]);
  async function review() {
    if (inputErrors.size) return;
    setBusy(true); setError(""); setQuoteError(false);
    try {
      const inputs = funded.filter(b => !excluded[b.assetId] && (!operation || operation.legs.some(l => l.asset.assetId === b.assetId && l.state === "ready"))).map(b => ({ assetId: b.assetId, amount: amounts[b.assetId] ?? b.amount })).filter(i => new D(i.amount || "0").gt(0));
      const result = await prepareFunding(inputs); setLocal(result.operation); await refresh();
      await confirmTransfer(result.operation);
    } catch { setQuoteError(true); }
    finally { setBusy(false); }
  }
  const confirmTransfer = useCallback(async (batch = operation) => {
    function ensureCurrentQuote() {
      const current = Date.now();
      if (batch && Date.parse(batch.expiresAt) > current) return true;
      setNow(current); setError("Funding quote has expired. Refresh the quote before confirming.");
      return false;
    }
    if (!mounted.current || !batch) return;
    setBusy(true); setError("");
    const selected = batch.legs.filter(l => l.state === "ready");
    try {
      for (let i = 0; i < selected.length; i++) {
        if (!mounted.current || !ensureCurrentQuote()) return;
        const leg = selected[i]; setProgress(`Confirming (${i + 1}/${selected.length})`);
        const { options } = await authorizeFunding(batch.id, leg.id);
        if (!mounted.current || !ensureCurrentQuote()) return;
        const assertion = await startAuthentication({ optionsJSON: options });
        if (!mounted.current || !ensureCurrentQuote()) return;
        const result = await submitFunding(assertion);
        if (!mounted.current) return;
        setLocal(result.operation);
        if (result.operation.state === "unknown") throw new Error("A submission outcome is uncertain. Check its status before trying again.");
      }
      feedback("success");
    } catch (e) {
      if (!mounted.current) return;
      if (isConfirmationCancelled(e)) toast(TOAST_MESSAGES.confirmationCancelled);
      else {
        feedback("error");
        setError(e instanceof Error ? e.message : "Confirmation stopped. Check each route below.");
      }
      // Only unsigned routes are cancelled. Already submitted routes keep tracking.
      try { setLocal((await cancelFunding(batch.id)).operation); } catch { /* Refetch durable state below. */ }
    } finally { setProgress(""); setBusy(false); await refresh(); }
  }, [operation, refresh, feedback]);
  async function cancel(back = false) {
    if (!operation) return;
    setBusy(true); setError("");
    try { const result = await cancelFunding(operation.id); setLocal(result.operation); await refresh(); if (back && !unresolved(result.operation) && result.operation.legs.every(l => l.state === "cancelled")) setLocal(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to cancel unsigned routes."); }
    finally { setBusy(false); }
  }
  const statusView = !!operation && operation.state !== "ready" && !operation.legs.some(l => l.state === "ready");
  // An expired confidential session needs a passkey unlock, not a retry.
  const accessRequired = balances.error instanceof ConfidentialAccessRequired;
  const dataUnavailable = !!(balances.error || catalog.error || history.error);
  const refreshing = balances.isFetching || catalog.isFetching || history.isFetching;
  const confirmedOutcome = !!operation && ["settled", "failed", "cancelled", "partial"].includes(operation.state) && operation.legs.length > 0 && operation.legs.every(leg => ["settled", "failed", "cancelled"].includes(leg.state));
  const statusUnavailable = !!history.error && !confirmedOutcome;
  const statusTitle = statusUnavailable ? "Unable to check transfer" : operation?.state === "settled" ? "Transfer complete" : operation?.state === "partial" ? "Transfer partially completed" : operation?.state === "failed" ? "Transfer couldn’t be completed" : operation?.state === "cancelled" ? "Transfer cancelled" : operation?.state === "unknown" ? "Checking your transfer" : "Transfer processing";
  const alerts = <>
    {!statusView && accessRequired && <ConfidentialAccess panel />}
    {!statusView && ((balances.error && !accessRequired) || catalog.error || history.error) && <Alert variant="destructive"><AlertDescription>Funding data is unavailable. <Button variant="outline" disabled={refreshing} onClick={() => { void balances.refetch(); void catalog.refetch(); void history.refetch(); }}>{refreshing && <LoaderCircle  aria-hidden="true" />}{refreshing ? "Retrying…" : "Retry"}</Button></AlertDescription></Alert>}
    {catalog.data && !tradingAvailable && <Alert><AlertDescription>USDC on NEAR is currently unavailable. Your balances remain in Funding.</AlertDescription></Alert>}
    {quoteError && <Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertDescription>Couldn’t get a quote.</AlertDescription></Alert>}
    {!!inputErrors.size && <Alert variant="destructive"><AlertDescription>{insufficientBalance ? "One or more amounts exceed available balances." : "Enter amounts within each token’s supported precision."}</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </>;
  if (statusView && operation) return <TransactionStatus>
    <TransactionStatusBody>
      {statusUnavailable || operation?.state === "failed" ? <CircleX className="size-12 text-destructive" aria-hidden="true" /> : operation?.state === "settled" ? <CircleCheck className="size-12 text-primary" aria-hidden="true" /> : ["partial", "cancelled"].includes(operation?.state ?? "") ? <TriangleAlert className="size-12 text-muted-foreground" aria-hidden="true" /> : <LoaderCircle className="size-12  text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />}
      <DialogDrawerTitle>{statusTitle}</DialogDrawerTitle><p className="text-sm text-muted-foreground">{statusUnavailable ? "We couldn’t retrieve the latest status. Please try again." : operation?.state === "settled" ? "Your converted funds are available for trading." : operation?.state === "partial" ? "Check unsuccessful routes before trying again." : operation?.state === "unknown" ? "Do not submit again while we check the outcome." : operation?.state === "failed" ? "Check Activity for refund information." : operation?.state === "cancelled" ? "Unsubmitted routes were cancelled." : "You can close this window and track progress in Activity."}</p>
      {operation.legs.length === 1 && <p className="text-xs text-muted-foreground"><FormattedNumber value={operation.legs[0].amount} symbol={displaySymbol(operation.legs[0].asset)} format="exact" /> · {networkName(operation.legs[0].asset.blockchain)}</p>}
    </TransactionStatusBody>
    {operation.legs.length > 1 && <ul className="space-y-2">{operation.legs.map(leg => <li key={leg.id} className="flex items-center justify-between gap-2"><span><FormattedNumber value={leg.amount} symbol={displaySymbol(leg.asset)} format="exact" /> · {networkName(leg.asset.blockchain)}</span><Badge variant="outline">{labels[leg.state]}</Badge></li>)}</ul>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {history.error && confirmedOutcome && <Alert variant="destructive"><AlertDescription>Status updates are unavailable. Showing the confirmed transfer outcome.</AlertDescription></Alert>}
    <div className="flex flex-col gap-2">
      {history.error && <Button className="w-full" disabled={history.isFetching} onClick={() => void history.refetch()}>{history.isFetching && <LoaderCircle  aria-hidden="true" />}{history.isFetching ? "Retrying…" : "Retry"}</Button>}
      {operation.state === "settled" && <Button className="w-full" onClick={onComplete}>Done</Button>}
      {onDetails && operation.state !== "settled" && operation.state !== "cancelled" && <Button className="w-full" variant={history.error ? "outline" : "default"} onClick={onDetails}>{["failed", "partial"].includes(operation.state) ? "View details" : "View activity"}</Button>}
      {!history.error && !unresolved(operation) && operation.state !== "settled" && <Button className="w-full" variant={onDetails ? "outline" : "default"} disabled={busy || !ready} onClick={() => { setLocal(null); setError(""); setExcluded(Object.fromEntries(funded.map(b => [b.assetId, !operation.legs.some(l => l.asset.assetId === b.assetId && ["failed", "cancelled"].includes(l.state))]))); }}>Review remaining balances</Button>}
    </div>
  </TransactionStatus>;
  if (!operation && !guideDismissed && history.isSuccess && !history.data?.operations.some(batch => batch.state === "settled")) return <section className="min-w-0 w-full max-w-full space-y-4">
    <DialogDrawerHeader onBack={guideStep > 0 ? () => setGuideStep(guideStep - 1) : undefined} backLabel="Previous explanation step"><DialogDrawerTitle>Funding and Trading</DialogDrawerTitle></DialogDrawerHeader>
    <FundingTradingGuide step={guideStep} onStepChange={setGuideStep} onDismiss={dismissGuide} />
  </section>;
  return <section className="space-y-4">
    <DialogDrawerHeader onBack={operation?.legs.some(l => l.state === "ready") ? () => void cancel(true) : undefined} backLabel="Back to funding balances" backDisabled={busy}><DialogDrawerTitle>Transfer to trading</DialogDrawerTitle><DialogDrawerDescription className="sr-only">Convert your funding stablecoins to USDC on NEAR.</DialogDrawerDescription></DialogDrawerHeader>
    {operation ? <>
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        {busy && <LoaderCircle className="size-8  text-muted-foreground" aria-hidden="true" />}
        <p role="status" className="text-sm text-muted-foreground">{busy ? progress || `Opening ${DYA_BRAND.idName}…` : expired ? "Quote expired. Continue to get a new quote." : `Continue in ${DYA_BRAND.idName} to review and confirm your transfer.`}</p>
      </div>
      {operation.excluded.map(i => <Alert key={i.asset.assetId}><AlertDescription><FormattedNumber value={i.amount} symbol={displaySymbol(i.asset)} format="exact" /> · {networkName(i.asset.blockchain)}: {i.reason}</AlertDescription></Alert>)}
      {alerts}
      {operation.legs.some(l => l.state === "ready") && !busy && <Button className="w-full" disabled={!ready || !!inputErrors.size || operation.state === "unknown"} onClick={() => void (expired || quoteError ? review() : confirmTransfer())}>{expired ? "Refresh quote" : "Continue"}</Button>}
    </> : <>
      {!!funded.length && !dataUnavailable && <>
        <div className="flex flex-col items-center gap-4 py-3">
          <div className="space-y-1 text-center"><p className="text-4xl font-semibold tabular-nums" aria-label="Selected funding value">{sourceValue === null ? "-" : <FormattedNumber value={sourceValue.toFixed()} format="currency" />}</p><p className="text-sm text-muted-foreground">Available to transfer</p></div>
          <FundingRoute networks={networks} />
        </div>
        <DetailsDisclosure open={breakdownOpen} onOpenChange={setBreakdownOpen} aria-label="Show funding breakdown" label="Details">
          <div className="space-y-4">
      {funded.map(b => <div className="space-y-2" key={b.assetId}>
        <div className="flex items-center gap-2">
          <Checkbox aria-label={`Select ${displaySymbol(b.asset)} on ${networkName(b.asset.blockchain)}`} checked={!excluded[b.assetId]} disabled={busy} onCheckedChange={checked => setExcluded({ ...excluded, [b.assetId]: !checked })} />
          <AssetMark asset={b.asset} network={b.asset.blockchain} size={24} />
          <span className="min-w-0 flex-1 text-sm">{displaySymbol(b.asset)} · {networkName(b.asset.blockchain)}</span>
          <Button variant="ghost" size="sm" className={inputErrors.has(b.assetId) ? "text-destructive tabular-nums" : "tabular-nums"} aria-label={`Edit ${displaySymbol(b.asset)} on ${networkName(b.asset.blockchain)}`} aria-expanded={editingAsset === b.assetId} aria-controls={`funding-editor-${b.assetId}`} disabled={busy || excluded[b.assetId]} onClick={() => setEditingAsset(editingAsset === b.assetId ? null : b.assetId)}><FormattedNumber value={amounts[b.assetId] ?? b.amount} exactTooltip /></Button>
        </div>
        <div id={`funding-editor-${b.assetId}`} hidden={editingAsset !== b.assetId}>
          <Label className="sr-only" htmlFor={`funding-${b.assetId}`}>{displaySymbol(b.asset)} · {networkName(b.asset.blockchain)}</Label>
          <div className="flex gap-2"><Input id={`funding-${b.assetId}`} inputMode="decimal" autoComplete="off" aria-invalid={inputErrors.has(b.assetId)} className={inputErrors.has(b.assetId) ? "text-destructive" : undefined} value={amounts[b.assetId] ?? b.amount} disabled={busy || excluded[b.assetId]} onChange={e => { if (/^\d*(\.\d*)?$/.test(e.target.value)) setAmounts({ ...amounts, [b.assetId]: e.target.value === "." ? "0." : e.target.value }); }} /><Button variant="outline" disabled={busy || excluded[b.assetId]} onClick={() => setAmounts({ ...amounts, [b.assetId]: b.amount })}>Max</Button></div>
        </div>
      </div>)}
          </div>
        </DetailsDisclosure>
      </>}
      {!funded.length && !dataUnavailable && !catalog.error && !balances.data && <p role="status" className="flex items-center gap-2"><LoaderCircle  aria-hidden="true" />Loading balances…</p>}
      {ready && !funded.length && <p>No supported stablecoins in Funding.</p>}
      {alerts}
      {!!funded.length && !dataUnavailable && <Button className="w-full" disabled={busy || !ready || !!inputErrors.size || !funded.some(b => !excluded[b.assetId] && new D((amounts[b.assetId] ?? b.amount) || "0").gt(0))} onClick={() => void review()} aria-live="polite">{busy && <LoaderCircle  aria-hidden="true" />}{busy ? "Getting quote…" : insufficientBalance ? "Insufficient balance" : quoteError ? "Try again" : "Continue"}</Button>}
    </>}
  </section>;
}
