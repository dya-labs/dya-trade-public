"use client";
import { fundingAssets } from "@dya/wallet-contracts/src/domain/funding-balances";
import { formatCountdown } from "@dya/ui/lib/format-countdown";
import { toast } from "@dya/ui/lib/toast";
import { useHapticFeedback } from "@dya/ui/hooks/use-haptic-feedback";
import { tokenAllowed } from "../../../../wallet-contracts/src/domain/token-registry";
import { useNetworkName } from "../../hooks/use-network-name";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { WalletTitle as DialogDrawerTitle, WalletDescription as DialogDrawerDescription } from "../presentation";
import { TransactionStatus, TransactionStatusBody } from "./transaction-status";
import { isSupportedStablecoin } from "../../lib/near/domain/stablecoins";
import { prepareDeposit } from "../../lib/near/http/transfers-client";
import { Check, Copy, CircleCheck, CircleX, LoaderCircle, TriangleAlert, Undo2, Clock } from "@dya/ui/icons";
import { depositQrDataUrl } from "../../lib/deposit-qr";
import { SuccessMark } from "@dya/ui/components/success-mark";
import { Tooltip, TooltipTrigger, TooltipContent } from "@dya/ui/components/tooltip";
import { useEffect, useRef, useState } from "react";
import { useCatalogQuery } from "../../hooks/use-wallet-queries";
import { DEFAULT_PAIR } from "../../lib/near/domain/catalog";
import { depositAssets, depositSources, depositTokenKey, groupDepositTokens } from "../../lib/near/domain/deposit-assets";
import { displaySymbol } from "../../lib/near/domain/canonical-assets";
import { NetworkMark } from "./network-mark";
import { AssetMark } from "./asset-mark";
import { TokenChoiceRow } from "../token-choice-row";
import { LabeledSelectTrigger } from "../labeled-select-trigger";
import { useQueryClient } from "@tanstack/react-query";
import { useDepositStatus } from "./use-deposit-status";
import type { TrackedDepositQuote } from "../../lib/near/http/schemas/transfers";
import { Button } from "@dya/ui/components/button";
import { Checkbox } from "@dya/ui/components/checkbox";
import { Input } from "@dya/ui/components/input";
import { Label } from "@dya/ui/components/label";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { Stepper } from "@dya/ui/components/stepper";
import { DialogDrawerHeader } from "@dya/ui/components/dialog-drawer";


type DepositInstructions = Pick<TrackedDepositQuote, "id" | "deadline" | "depositAddress" | "depositMemo" | "asset" | "sourceChain" | "sourceNetwork" | "sourceAssetId" | "targetAssetId" | "amountInFormatted" | "minAmountInFormatted" | "showDollarBuffer">;
export type ExactDepositSource = {
  prepare: (amount: string) => Promise<DepositInstructions>;
  readStatus: (id: string, signal: AbortSignal) => Promise<{status: string; terminal: boolean}>;
  onSettled: () => void;
};

export function LegacyDepositForm({ accountId, initialQuote = null, onClose, onDetails, onBusyChange, onMoveToTrading, exactDeposit, tradingWalletId }: { accountId: string; initialQuote?: TrackedDepositQuote | null; onClose?: () => void; onDetails?: () => void; onBusyChange?: (busy: boolean) => void; onMoveToTrading?: () => void; exactDeposit?: ExactDepositSource; tradingWalletId?: string }) {
  const feedback = useHapticFeedback();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const queryClient = useQueryClient();
  const [consented, setConsented] = useState(!!initialQuote);
  const [acknowledged, setAcknowledged] = useState(false);
  const [quote, setQuote] = useState<DepositInstructions | null>(initialQuote);
  const [depositAmount, setDepositAmount] = useState("");
  const validAmount = /^(?:[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(depositAmount);
  const catalog = useCatalogQuery();
  const networkName = useNetworkName();
  const [targetId, setTargetId] = useState<string>(DEFAULT_PAIR.quote.assetId);
  const [sourceId, setSourceId] = useState("");
  const [picker, setPicker] = useState<"token" | "network" | null>(null);
  const [search, setSearch] = useState("");
  const assets = groupDepositTokens(depositAssets(catalog.data?.assets ?? [], catalog.data?.tokens ?? [], "deposits").filter(a => depositSources(a, catalog.data?.assets ?? []).some(source => tokenAllowed(source, catalog.data?.tokens?.find(t => t.id === source.assetId), "deposits") && catalog.data?.networks?.some(n => n.id === source.blockchain && n.status === "approved" && n.deposits))));
  const target = (catalog.data?.assets ?? []).find(a => a.assetId === targetId);
  const sources = target ? depositSources(target, catalog.data?.assets ?? []).filter(a => tokenAllowed(a, catalog.data?.tokens?.find(t => t.id === a.assetId), "deposits") && catalog.data?.networks?.some(n => n.id === a.blockchain && n.status === "approved" && n.deposits)) : [];
  const source = sources.find(a => a.assetId === sourceId);
  const statusQuery = useDepositStatus(accountId, quote?.id, exactDeposit?.readStatus);
  const status = statusQuery.data ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const countdown = formatCountdown(quote ? Date.parse(quote.deadline) : now, now);
  const expiryDescription = `Address expires in ${countdown.description}`;
  const paymentAsset = quote && (catalog.data?.assets ?? []).find(asset => asset.assetId === quote.sourceAssetId) || (quote ? (catalog.data?.assets ?? []).find(asset => asset.symbol === quote.asset && asset.blockchain === quote.sourceNetwork) : source || target);
  const depositTarget = quote && (catalog.data?.assets ?? []).find(asset => asset.assetId === (quote.targetAssetId ?? paymentAsset?.assetId));
  const moveToTrading = !!onMoveToTrading && !!depositTarget && fundingAssets([depositTarget]).length > 0;
  const expired = !!quote && now >= Date.parse(quote.deadline);
  const [qrFailed, setQrFailed] = useState(false);
  const [qr, setQr] = useState(""), [copied, setCopied] = useState<{ part: "address" | "memo"; value: string } | null>(null);
  const copyAttempt = useRef(0);
  const copyQueue = useRef<Promise<void>>(Promise.resolve());
  const copyContext = useRef<{ quote: DepositInstructions | null; allowed: boolean }>({ quote: null, allowed: false });
  useEffect(() => {
    copyContext.current = { quote, allowed: !!quote && !statusQuery.error && (!status || status.status === "PENDING_DEPOSIT") && !(initialQuote && !status) };
  }, [quote, status, statusQuery.error, initialQuote]);
  const copiedPart = copied && quote && copied.value === (copied.part === "address" ? quote.depositAddress : quote.depositMemo) ? copied.part : null;
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(null), 2000); return () => clearTimeout(timer); }, [copied]);

  function clear() { ++copyAttempt.current; setQuote(null); setQr(""); setQrFailed(false); setCopied(null); setError(""); }
  async function copy(value: string, part: "address" | "memo") {
    const current = () => mounted.current && !!quote && copyContext.current.quote === quote && copyContext.current.allowed && Date.now() < Date.parse(quote.deadline);
    if (!current()) return;
    const attempt = ++copyAttempt.current;
    // Address and memo differ: order clipboard writes, not just their feedback.
    const pending = copyQueue.current.catch(() => {}).then(() => { if (current()) return navigator.clipboard.writeText(value); });
    copyQueue.current = pending;
    try { await pending; if (!current() || attempt !== copyAttempt.current) return; feedback("light"); setCopied({ part, value }); }
    catch { if (!current() || attempt !== copyAttempt.current) return; setCopied(null); toast.error(`Unable to copy ${part}. Please select and copy it manually.`); }
  }
  async function refreshDeposits() { await queryClient.invalidateQueries({ queryKey: ["near", "account", accountId, "transfers"] }); }
  async function prepare() {
    if (!mounted.current || busy) return;
    setBusy(true); clear();
    try {
      const next = exactDeposit ? await exactDeposit.prepare(depositAmount) : await prepareDeposit({ tradingWalletId, sourceAssetId: sourceId, targetAssetId: source && isSupportedStablecoin(source) ? sourceId : targetId });
      if (!mounted.current) return;
      setQuote(next); await refreshDeposits();
    }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Unable to create deposit quote"); }
    finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (!quote) return;
    let stopped = false;
    void depositQrDataUrl(quote.depositAddress)
      .then(value => { if (!stopped) setQr(value); })
      .catch(() => { if (!stopped) { setQrFailed(true); setError("Unable to render deposit QR code"); } });
    return () => { stopped = true; };
  }, [quote]);
  useEffect(() => {
    if (status?.status === "SUCCESS") exactDeposit?.onSettled();
  }, [status?.status, exactDeposit]);
  useEffect(() => {
    if (status?.status !== "SUCCESS" || exactDeposit) return;
    if (tradingWalletId) {
      void queryClient.invalidateQueries({ queryKey: ["id", "trading-token-balances", tradingWalletId] });
      void queryClient.invalidateQueries({ queryKey: ["id", "trading-activity", tradingWalletId] });
    } else {
      void queryClient.invalidateQueries({ queryKey: ["near", "account", accountId] });
    }
  }, [status?.status, status?.terminal, accountId, queryClient, exactDeposit, tradingWalletId]);

  if (quote && status && !["PENDING_DEPOSIT", "FAILED", "REFUNDED", "INCOMPLETE_DEPOSIT"].includes(status.status)) {
    const complete = status.status === "SUCCESS";
    return <section className="min-w-0 space-y-4">
      <DialogDrawerHeader><DialogDrawerTitle>Deposit</DialogDrawerTitle><DialogDrawerDescription className="sr-only">One-time confidential deposit</DialogDrawerDescription></DialogDrawerHeader>
      <Stepper steps={["Important", "Configure", "Deposit"]} aria-label="Deposit steps" current={3} loading={!complete} complete={complete} />
      <div role="status" aria-live="polite" className="space-y-2 px-3 py-6 text-center">
        <h3 className="text-sm font-medium">{complete ? "Deposit complete" : "Deposit received"}</h3>
        <p className="text-sm text-muted-foreground">{complete ? moveToTrading ? "Funds received in Funding. Move them to Trading to start trading." : "Your deposit is complete. Your balance is refreshing." : "We’re processing your deposit. You can safely close this window."}</p>
        <p className="text-xs text-muted-foreground">{quote.asset} · {quote.sourceChain}</p>
      </div>
      {statusQuery.error && <Alert variant="destructive"><AlertDescription>Status updates are temporarily unavailable. <Button variant="outline" disabled={statusQuery.isFetching} onClick={() => void statusQuery.refetch()}>Retry</Button></AlertDescription></Alert>}
      {complete && moveToTrading ? <Button className="w-full" onClick={onMoveToTrading}>Move to Trading</Button> : onClose && <Button className="w-full" onClick={onClose}>Done</Button>}
    </section>;
  }

  // Once detected, never invite a second transfer to this single-use address.
  // Reopened deposits are checked before displaying any payment instructions.
  const paymentStatusUnconfirmed = !!statusQuery.error && (!status || status.status === "PENDING_DEPOSIT");
  if (quote && (paymentStatusUnconfirmed || (initialQuote && !status) || (status && status.status !== "PENDING_DEPOSIT"))) {
    const state = paymentStatusUnconfirmed ? undefined : status?.status;
    const complete = state === "SUCCESS";
    const attention = state === "FAILED" || state === "REFUNDED" || state === "INCOMPLETE_DEPOSIT";
    const checkingError = !state && !!statusQuery.error;
    const title = checkingError ? "Unable to check deposit" : complete ? "Deposit complete" : state === "REFUNDED" ? "Deposit refunded" : state === "FAILED" ? "Deposit couldn’t be completed" : state === "INCOMPLETE_DEPOSIT" ? "Deposit needs attention" : state ? "Deposit received" : "Checking your deposit";
    const description = checkingError ? "We couldn’t retrieve the latest status. Please try again."
      : complete ? "Your deposit is complete. Your balance is refreshing."
      : state === "REFUNDED" ? "Funds were returned to the configured refund address."
      : attention ? "View the details for the latest status and next steps. Do not send more to this deposit address."
      : state ? "We’re processing your deposit. You can safely close this window."
      : "This should only take a moment.";
    return <TransactionStatus>
      <TransactionStatusBody>
        {complete ? <CircleCheck className="size-12 text-primary" aria-hidden="true" />
          : state === "REFUNDED" ? <Undo2 className="size-12 text-muted-foreground" aria-hidden="true" />
          : state === "INCOMPLETE_DEPOSIT" ? <TriangleAlert className="size-12 text-muted-foreground" aria-hidden="true" />
          : state === "FAILED" || checkingError ? <CircleX className="size-12 text-destructive" aria-hidden="true" />
          : <LoaderCircle className="size-12  text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />}
        <DialogDrawerTitle>{title}</DialogDrawerTitle><p className="text-sm text-muted-foreground">{description}</p>
        <p className="text-xs text-muted-foreground">{quote.asset} · {quote.sourceChain}</p>
      </TransactionStatusBody>
      {statusQuery.error && !checkingError && <Alert variant="destructive"><AlertDescription>Status updates are temporarily unavailable. <Button variant="outline" disabled={statusQuery.isFetching} onClick={() => void statusQuery.refetch()}>Retry</Button></AlertDescription></Alert>}
      {checkingError ? <Button className="w-full" disabled={statusQuery.isFetching} onClick={() => void statusQuery.refetch()}>{statusQuery.isFetching && <LoaderCircle  aria-hidden="true" />}{statusQuery.isFetching ? "Retrying…" : "Retry"}</Button>
        : attention && onDetails ? <Button className="w-full" onClick={onDetails}>View details</Button>
        : onClose && state ? <Button className="w-full" onClick={onClose}>Done</Button> : null}
    </TransactionStatus>;
  }

  if (quote && expired) return <TransactionStatus>
    <div role="status" aria-live="polite" className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center">
      <Clock className="size-12 text-muted-foreground" aria-hidden="true" />
      <DialogDrawerTitle>Deposit address expired</DialogDrawerTitle><p className="text-sm text-muted-foreground">Create a new address to make a deposit. Don’t send funds to the expired address.</p>
      <p className="text-xs text-muted-foreground">{quote.asset} · {quote.sourceChain}</p>
    </div>
    <Button className="w-full" onClick={clear}>Create new address</Button>
    {onDetails && <Button variant="link" onClick={onDetails}>Already sent funds? View status</Button>}
  </TransactionStatus>;

  if (!quote && catalog.data && !catalog.error && !assets.length && !exactDeposit) return <section className="space-y-4">
    <DialogDrawerHeader><DialogDrawerTitle>Deposit</DialogDrawerTitle><DialogDrawerDescription className="sr-only">Deposits are temporarily unavailable.</DialogDrawerDescription></DialogDrawerHeader>
    <div role="status" className="px-4 py-6 text-center">
      <p className="text-sm font-medium">Deposits temporarily unavailable</p>
      <p className="mt-2 text-sm text-muted-foreground">No deposit networks are available right now. Please check back later.</p>
    </div>
  </section>;

  if (!consented) return <section className="space-y-4">
    <DialogDrawerHeader><DialogDrawerTitle>Deposit</DialogDrawerTitle><DialogDrawerDescription className="sr-only">One-time confidential deposit</DialogDrawerDescription></DialogDrawerHeader>
    <Stepper steps={["Important", "Configure", "Deposit"]} aria-label="Deposit steps" current={1} />
    <h3 className="text-sm font-medium">Before you continue</h3>
    <ul className="space-y-3 text-sm">
      <li className="flex items-start gap-3"><CircleCheck aria-hidden="true" className="size-5 shrink-0 text-primary" /><span>Minimum deposit value $1 USD</span></li>
      <li className="flex items-start gap-3"><CircleX aria-hidden="true" className="size-5 shrink-0 text-destructive" /><span>Do not send a test deposit first</span></li>
      <li className="flex items-start gap-3"><CircleX aria-hidden="true" className="size-5 shrink-0 text-destructive" /><span>Do not reuse, save, whitelist, or share the address</span></li>
    </ul>
    <div className="flex items-start gap-3">
      <Checkbox id="deposit-consent" checked={acknowledged} onCheckedChange={checked => setAcknowledged(checked === true)} />
      <Label htmlFor="deposit-consent">I understand this is a single-use address, and that I must send at least $1 USD in one transfer.</Label>
    </div>
    <Button className="w-full" disabled={!acknowledged} onClick={() => setConsented(true)}>Continue</Button>
  </section>;

  if (picker) {
    const options = picker === "token" ? assets : sources;
    const filtered = options.filter(asset => (picker === "token" ? displaySymbol(asset) : networkName(asset.blockchain)).toLowerCase().includes(search.trim().toLowerCase()));
    return <section className="min-w-0 space-y-4">
      <DialogDrawerHeader onBack={() => setPicker(null)} backLabel="Back to deposit">
        <DialogDrawerTitle>Select {picker}</DialogDrawerTitle>
        <DialogDrawerDescription className="sr-only">Choose a {picker} for your deposit.</DialogDrawerDescription>
      </DialogDrawerHeader>
      <Input autoFocus aria-label={`Search ${picker}s`} placeholder={`Search ${picker}s`} value={search} onChange={event => setSearch(event.target.value)} />
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{picker === "token" ? "Token" : "Network"}</p>
        <div className="-mx-2 max-h-80 space-y-1 overflow-y-auto">
          {filtered.map(asset => picker === "token" ? <TokenChoiceRow key={asset.assetId} asset={asset} label={displaySymbol(asset)} selected={!!target && depositTokenKey(target) === depositTokenKey(asset)} onSelect={() => { feedback(); setTargetId(asset.assetId); setSourceId(""); clear(); setPicker(null); }} /> : <Button key={asset.assetId} type="button" variant="ghost" className="h-auto min-h-12 w-full justify-start rounded-[6px] border-0 px-2 transition-none hover:bg-hover hover:text-foreground focus-visible:bg-hover dark:hover:bg-hover" onClick={() => {
            feedback();
            setSourceId(asset.assetId);
            clear(); setPicker(null);
          }}>
            <NetworkMark network={asset.blockchain} />
            <span className="min-w-0 flex-1 text-left">
              {networkName(asset.blockchain)}
              {picker === "network" && sources.filter(item => item.blockchain === asset.blockchain).length > 1 && <span className="block truncate text-xs text-muted-foreground">{asset.contractAddress ?? asset.assetId}</span>}
            </span>
            {asset.assetId === sourceId && <Check className="size-4" />}
          </Button>)}
          {!filtered.length && <p className="py-6 text-center text-sm text-muted-foreground">No {picker}s found.</p>}
        </div>
      </div>
    </section>;
  }

  return <section className="min-w-0 space-y-4">
    <DialogDrawerHeader><DialogDrawerTitle>Deposit</DialogDrawerTitle><DialogDrawerDescription className="sr-only">One-time confidential deposit</DialogDrawerDescription></DialogDrawerHeader>

    <Stepper steps={["Important", "Configure", "Deposit"]} aria-label="Deposit steps" current={quote ? 3 : 2} loading={busy && !quote} complete={!!quote && status?.status === "SUCCESS"} />
    {busy && !quote ? <div role="status" aria-live="polite" className="space-y-2 px-3 py-6 text-center">
      <h3 className="text-sm font-medium">Creating deposit address…</h3>
      {source && <p className="text-sm text-muted-foreground">{displaySymbol(source)} · {networkName(source.blockchain)}</p>}
    </div> : !quote ? <div className="space-y-4">
      {exactDeposit ? <div className="space-y-2"><Label htmlFor="trading-deposit-amount">USDC on Base</Label><Input id="trading-deposit-amount" inputMode="decimal" value={depositAmount} onChange={event => setDepositAmount(event.target.value)} placeholder="Amount" /></div> : <><div className="space-y-2">
      <LabeledSelectTrigger disabled={busy || !catalog.data} onClick={() => { setSearch(""); setPicker("token"); }} aria-label="Deposit token" label="Token" value={target && sources.length ? displaySymbol(target) : null} placeholder="Select token" icon={target && sources.length > 0 && <AssetMark asset={target} size={36} />} />
      <LabeledSelectTrigger disabled={busy || !target || !sources.length} onClick={() => { setSearch(""); setPicker("network"); }} aria-label="Deposit network" label="Network" value={source ? networkName(source.blockchain) : null} placeholder="Select network" icon={source && <NetworkMark network={source.blockchain} size={36} />} />
      </div>
      {catalog.data && assets.length > 0 && target && !sources.length && <p role="status" className="text-sm text-muted-foreground">Choose another token to deposit.</p>}
      </>}
      {!exactDeposit && catalog.error && <Alert variant="destructive"><AlertDescription>Token catalog unavailable. <Button variant="outline" onClick={() => void catalog.refetch()}>Retry</Button></AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <Button className="w-full" disabled={(exactDeposit ? !validAmount : !source) || busy} onClick={() => void prepare()}>{busy && <LoaderCircle  aria-hidden="true" />}{busy ? "Creating deposit address…" : error ? "Try again" : "Create deposit address"}</Button>
    </div> : <div className="space-y-4">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="space-y-2 text-center">
        <div className="flex items-center justify-center gap-1.5 text-sm">
          {paymentAsset && <span className="flex items-center justify-center" style={{ width: 20, height: 20 }}><span style={{ display: "flex", transform: "scale(0.833333)" }}><AssetMark asset={paymentAsset} /></span></span>}
          <span className="font-medium text-foreground">{quote.asset}</span><span className="text-muted-foreground">on</span>
          <NetworkMark network={quote.sourceNetwork ?? (quote.sourceChain === "BSC" ? "bsc" : quote.sourceChain.toLowerCase())} size={16} /><span className="text-muted-foreground">{quote.sourceChain}</span>
        </div>
      <p className="text-sm text-muted-foreground">{quote.showDollarBuffer && (quote.asset !== "USDC" || Number(quote.minAmountInFormatted) <= 1) ? (quote.asset === "USDC" ? "Send at least 1 USDC" : `Send at least $1 worth of ${quote.asset}`) : <>{quote.minAmountInFormatted ? "Send more than" : "Send exactly"} <FormattedNumber value={quote.minAmountInFormatted ?? quote.amountInFormatted} format="exact" symbol={quote.asset} /></>}</p>
      </div>
      <div className="flex justify-center">
        <button type="button" data-deposit-copy data-copied={copiedPart === "address"} aria-label={copiedPart === "address" ? "Address copied" : "Copy address"} disabled={expired} onClick={() => void copy(quote.depositAddress, "address")} className="relative flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-dialog)] border border-border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ background: "var(--qr-background)", color: "var(--qr-foreground)", width: 228, maxWidth: "100%" }}>
          <span className="flex items-center justify-center" style={{ width: 180, height: 180 }} aria-busy={!qr && !qrFailed}>
            {qr ? <img src={qr} alt={`QR code for ${quote.asset} deposit on ${quote.sourceChain}`} width={180} height={180} /> : <span role="status" className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
              {!qrFailed && <LoaderCircle className="size-5" />}<span>{qrFailed ? "QR code unavailable. Copy the address below." : "Preparing QR code…"}</span>
            </span>}
          </span>
          <span className="block w-full border-t border-border pt-2 text-center font-mono text-xs tabular-nums" aria-label={quote.depositAddress} title={quote.depositAddress}>
            <span className="block break-all">{quote.depositAddress.slice(0, Math.ceil(quote.depositAddress.length / 2))}</span>
            <span className="block break-all">{quote.depositAddress.slice(Math.ceil(quote.depositAddress.length / 2))}</span>
          </span>
          <span aria-hidden="true" className="grid h-4 text-xs text-muted-foreground">
            <span className="deposit-copy-hint" style={{ gridArea: "1 / 1" }}>Tap to copy address</span>
            <span className="deposit-copy-result flex items-center justify-center gap-1" style={{ gridArea: "1 / 1" }}><SuccessMark complete={copiedPart === "address"} />Copied</span>
          </span>
          <span role="status" className="sr-only">{copiedPart === "address" ? "Address copied" : ""}</span>
        </button>
      </div>
      <div className="flex items-center justify-center gap-2" style={{ marginTop: 8 }}>
        <Tooltip><TooltipTrigger className="inline-flex items-center rounded-full border border-border px-2 py-1 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">Single use</TooltipTrigger><TooltipContent>Send once. Don’t reuse or share this address.</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger aria-label={expiryDescription} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"><Clock aria-hidden="true" className="size-3" /><span className="tabular-nums">{countdown.text}</span></TooltipTrigger><TooltipContent>{expiryDescription}. Expires {new Date(quote.deadline).toLocaleString()}.</TooltipContent></Tooltip>
      </div>
      {quote.depositMemo && <div className="flex items-center gap-3 rounded-md border border-border p-3">
        <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">Required memo</p><p className="break-all font-mono text-xs">{quote.depositMemo}</p></div>
        <Button variant="ghost" size="icon-sm" aria-label={copiedPart === "memo" ? "Memo copied" : "Copy memo"} disabled={expired} onClick={() => void copy(quote.depositMemo!, "memo")}>{copiedPart === "memo" ? <Check /> : <Copy />}</Button>
      </div>}

    </div>}
  </section>;
}


export { WithdrawalForm } from "./withdrawal-form";
