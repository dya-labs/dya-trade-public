"use client";
import { isConfirmationCancelled } from "@dya/ui/lib/is-confirmation-cancelled";
import { TOAST_MESSAGES } from "@dya/config";
import { toast } from "@dya/ui/lib/toast";
import { useHapticFeedback } from "@dya/ui/hooks/use-haptic-feedback";
import { tokenAllowed } from "../../../../wallet-contracts/src/domain/token-registry";
import { useNetworkName } from "../../hooks/use-network-name";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { WalletTitle as DialogDrawerTitle, WalletDescription as DialogDrawerDescription } from "../presentation";
import { TransactionStatus, TransactionStatusBody } from "./transaction-status";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { startAuthentication } from "@simplewebauthn/browser";
import { Check, LoaderCircle, Search, CircleAlert, CircleCheck, CircleX } from "@dya/ui/icons";
import { useCatalogQuery } from "../../hooks/use-wallet-queries";
import { prepareWithdrawal, submitWithdrawal, getWithdrawalStatus } from "../../lib/near/http/transfers-client";
import { DEFAULT_PAIR } from "../../lib/near/domain/catalog";
import { depositAssets, depositSources, depositTokenKey, groupDepositTokens } from "../../lib/near/domain/deposit-assets";
import { displaySymbol } from "../../lib/near/domain/canonical-assets";
import { D } from "../../lib/near/domain/decimal";
import { shortenAddress } from "../../lib/format";
import { useBalanceQuery } from "./use-live-balances";
import { AssetMark } from "./asset-mark";
import { NetworkMark } from "./network-mark";
import { LabeledSelectTrigger } from "../labeled-select-trigger";
import { Button } from "@dya/ui/components/button";
import { Input } from "@dya/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@dya/ui/components/input-group";
import { RecipientAddress } from "./recipient-address";
import { Label } from "@dya/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@dya/ui/components/select";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { SendReview } from "../send-review";
import { SendAmount } from "../send-amount";
import { TokenChoiceRow } from "../token-choice-row";
import { DialogDrawerHeader } from "@dya/ui/components/dialog-drawer";

export type WithdrawalSource = {
  assetId?: string;
  prepare: (input: Parameters<typeof prepareWithdrawal>[0]) => Promise<
    Awaited<ReturnType<typeof prepareWithdrawal>> | { review: Pick<Awaited<ReturnType<typeof prepareWithdrawal>>["review"], "amount" | "asset" | "expectedReceive" | "destinationWallet" | "deadline">; options: Awaited<ReturnType<typeof prepareWithdrawal>>["options"]; id: string }
  >;
  submit: (assertion: Parameters<typeof submitWithdrawal>[0], id?: string) => ReturnType<WithdrawalSource["status"]>;
  status: (id: string) => Promise<{ withdrawal: Pick<Awaited<ReturnType<typeof getWithdrawalStatus>>["withdrawal"], "id" | "state"> & { review: Pick<Awaited<ReturnType<typeof getWithdrawalStatus>>["withdrawal"]["review"], "amount" | "asset" | "destinationChain"> }; terminal?: boolean }>;
  balances: Pick<ReturnType<typeof useBalanceQuery>, "error" | "isPending" | "isFetching"> & { data?: Pick<NonNullable<ReturnType<typeof useBalanceQuery>["data"]>, "assets">; refetch: () => unknown };
  onUpdated: () => void;
};

export function WithdrawalForm({ accountId, onClose, onDetails, onBusyChange, authenticate, withdrawalSource }: { accountId: string; onClose?: () => void; onDetails?: () => void; onBusyChange?: (busy: boolean) => void; authenticate: typeof startAuthentication; withdrawalSource?: WithdrawalSource }) {
  const feedback = useHapticFeedback();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const client = useQueryClient();
  const catalog = useCatalogQuery();
  const networkName = useNetworkName();
  const mainBalances = useBalanceQuery(withdrawalSource ? null : accountId);
  const balances = withdrawalSource?.balances ?? mainBalances;
  const [tokenId, setTokenId] = useState<string>(withdrawalSource?.assetId ?? DEFAULT_PAIR.quote.assetId);
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [picker, setPicker] = useState<"token" | "network" | null>(null);
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [wallet, setWallet] = useState("");
  const [prepared, setPrepared] = useState<Awaited<ReturnType<WithdrawalSource["prepare"]>> | null>(null);
  const [submitted, setSubmitted] = useState<Awaited<ReturnType<WithdrawalSource["submit"]>>["withdrawal"] | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const [error, setError] = useState("");
  const [quoteError, setQuoteError] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => { const initial = setTimeout(() => setNow(Date.now()), 0); const tick = setInterval(() => setNow(Date.now()), 1000); return () => { clearTimeout(initial); clearInterval(tick); }; }, []);
  const tokens = withdrawalSource?.assetId
    ? (catalog.data?.assets ?? []).filter(asset => asset.assetId === withdrawalSource.assetId)
    : depositAssets(catalog.data?.assets ?? [], catalog.data?.tokens ?? [], "withdrawals");
  const token = tokens.find(a => a.assetId === tokenId);
  const variants = token ? depositSources(token, catalog.data?.assets ?? []).filter(a => (!withdrawalSource?.assetId || a.assetId === withdrawalSource.assetId) && tokenAllowed(a, catalog.data?.tokens?.find(t => t.id === a.assetId), "withdrawals") && catalog.data?.networks?.some(n => n.id === a.blockchain && n.status === "approved" && n.withdrawals)) : [];
  const destination = variants.find(a => a.assetId === destinationId);
  const recentKey = `withdrawal-recipients:${accountId}:${destination?.blockchain ?? ""}`;
  const recent = useQuery({ queryKey: ["withdrawal-recipients", accountId, destination?.blockchain], enabled: !!destination, queryFn: () => {
    try { const stored: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]"); return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 256).slice(0, 5) : []; } catch { return []; }
  }, staleTime: Infinity });
  function selectRecipient(address: string) {
    const value = address.trim();
    if (!value) return;
    const addresses = [value, ...(recent.data ?? []).filter(item => item !== value)].slice(0, 5);
    try { localStorage.setItem(recentKey, JSON.stringify(addresses)); } catch { /* Selection still works if storage is unavailable. */ }
    client.setQueryData(["withdrawal-recipients", accountId, destination?.blockchain], addresses);
    setWallet(value); setSourceId(source?.assetId ?? ""); setStep(3);
  }
  const sources = variants.filter(a => balances.data?.assets.some(b => b.assetId === a.assetId && b.raw !== "0"));
  const source = sourceId ? variants.find(a => a.assetId === sourceId) : sources.find(a => a.assetId === tokenId) ?? sources[0] ?? token;
  const sourceChoices = source && !sources.some(a => a.assetId === source.assetId) ? [source, ...sources] : sources;
  const balance = balances.data?.assets.find(b => b.assetId === source?.assetId);
  const insufficientBalance = /^\d+(\.\d+)?$/.test(amount) && !!balance && new D(amount).gt(balance.amount);
  const validAmount = /^\d+(\.\d+)?$/.test(amount) && !!balance && new D(amount).gt(0) && new D(amount).lte(balance.amount) && (amount.split(".")[1]?.length ?? 0) <= balance.decimals;
  const quoteSeconds = prepared ? Math.max(0, Math.floor((Date.parse(prepared.review.deadline) - now) / 1000)) : 0;
  const expired = !!prepared && !(Date.parse(prepared.review.deadline) > now);
  const status = useQuery<Awaited<ReturnType<WithdrawalSource["status"]>>>({ queryKey: ["near", "account", accountId, "withdrawal", submitted?.id], enabled: !!submitted && !["settled", "failed"].includes(submitted.state), queryFn: () => (withdrawalSource?.status ?? getWithdrawalStatus)(submitted!.id), refetchInterval: query => query.state.data && (("terminal" in query.state.data && query.state.data.terminal) || ["settled", "failed"].includes(query.state.data.withdrawal.state)) ? false : 5000, retry: false });
  const operation = status.data?.withdrawal ?? submitted;
  useEffect(() => {
    if (!operation?.id || !["settled", "failed"].includes(operation.state)) return;
    if (withdrawalSource) { withdrawalSource.onUpdated(); return; }
    void client.invalidateQueries({ queryKey: ["near", "account", accountId, "balances"] });
    void client.invalidateQueries({ queryKey: ["near", "account", accountId, "transfers"] });
  }, [operation?.state, operation?.id, client, accountId, withdrawalSource]);
  async function prepare() {
    if (!source || !destination) return;
    setBusy(true); setError(""); setQuoteError(false);
    try { setPrepared(await (withdrawalSource?.prepare ?? prepareWithdrawal)({ originAssetId: source.assetId, destinationAssetId: destination.assetId, wallet: wallet.trim(), amount })); }
    catch { setPrepared(null); setQuoteError(true); }
    finally { setBusy(false); }
  }
  async function confirm() {
    function ensureCurrentQuote() {
      const current = Date.now();
      if (prepared && Date.parse(prepared.review.deadline) > current) return true;
      setNow(current); setError("Withdrawal quote has expired. Refresh the quote before confirming.");
      return false;
    }
    if (!mounted.current || !prepared?.options || !destination || !source || !ensureCurrentQuote()) return;
    setBusy(true); setError("");
    let submissionStarted = false;
    try {
      const assertion = await authenticate({ optionsJSON: prepared.options });
      if (!mounted.current || !ensureCurrentQuote()) return;
      submissionStarted = true;
      const { withdrawal } = await (withdrawalSource?.submit ?? submitWithdrawal)(assertion, "id" in prepared ? prepared.id : undefined);
      feedback(withdrawal.state === "failed" ? "error" : "success"); setSubmitted(withdrawal); setPrepared(null);
      if (withdrawalSource) withdrawalSource.onUpdated();
      else void client.invalidateQueries({ queryKey: ["near", "account", accountId, "transfers"] });
    } catch (e) {
      setUncertain(submissionStarted); setPrepared(null);
      const cancelled = !submissionStarted && isConfirmationCancelled(e);
      if (cancelled) toast(TOAST_MESSAGES.confirmationCancelled);
      else {
        feedback("error");
        setError(e instanceof Error ? e.message : "Unable to submit. Check transfer activity before retrying.");
      }
    }
    finally { setBusy(false); }
  }
  if (uncertain) return <section className="space-y-4"><TransactionStatus><TransactionStatusBody><CircleAlert /><h2>Submission unconfirmed</h2><p>The outcome is unconfirmed. Check transfer activity before sending again.</p></TransactionStatusBody><Button onClick={onDetails ?? onClose}>View transfer activity</Button></TransactionStatus></section>;
  if (operation) {
    const complete = operation.state === "settled";
    const failed = operation.state === "failed";
    const unavailable = !complete && !failed && !!status.error;
    const unknown = !complete && !failed && operation.state === "unknown";
    const title = complete ? "Withdrawal complete" : failed ? "Withdrawal couldn’t be completed" : unavailable ? "Unable to check withdrawal" : unknown ? (status.data && "terminal" in status.data && status.data.terminal ? "Withdrawal needs review" : "Checking your withdrawal") : "Withdrawal processing";
    const description = complete ? "Your withdrawal is complete. Your balance is refreshing."
      : failed ? "View the details for the latest status and any refund information."
      : unavailable ? "We couldn’t retrieve the latest status. Please try again."
      : unknown ? "We’re confirming the outcome. Check Activity before trying another withdrawal."
      : "You can close this window and track progress in Activity.";
    return <TransactionStatus>
      <TransactionStatusBody>
        {complete ? <CircleCheck className="size-12 text-primary" aria-hidden="true" />
          : failed || unavailable ? <CircleX className="size-12 text-destructive" aria-hidden="true" />
          : <LoaderCircle className="size-12  text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />}
        <DialogDrawerTitle>{title}</DialogDrawerTitle><p className="text-sm text-muted-foreground">{description}</p>
        <p className="text-xs text-muted-foreground">{!complete && !failed && !unavailable && !unknown ? "Sending " : "Withdrawal amount: "}<FormattedNumber value={operation.review.amount} symbol={operation.review.asset} /> · {operation.review.destinationChain}</p>
      </TransactionStatusBody>
      <div className="flex flex-col gap-2">
      {unavailable && <Button className="w-full" disabled={status.isFetching} onClick={() => void status.refetch()}>{status.isFetching && <LoaderCircle  aria-hidden="true" />}{status.isFetching ? "Retrying…" : "Retry"}</Button>}
      {complete ? <>{onClose && <Button className="w-full" onClick={onClose}>Done</Button>}{onDetails && <Button variant="outline" className="w-full" onClick={onDetails}>View details</Button>}</>
        : <>{onDetails && <Button variant={unavailable ? "outline" : "default"} className="w-full" onClick={onDetails}>{failed ? "View details" : "View activity"}</Button>}</>}
      </div>
    </TransactionStatus>;
  }
  if (picker) {
    const choices = picker === "token" ? groupDepositTokens(tokens) : variants;
    const filtered = choices.filter(a => `${displaySymbol(a)} ${networkName(a.blockchain)}`.toLowerCase().includes(search.toLowerCase().trim()));
    return <section className="min-w-0 space-y-4"><DialogDrawerHeader onBack={() => setPicker(null)} backLabel="Back to withdrawal"><DialogDrawerTitle>Select {picker}</DialogDrawerTitle><DialogDrawerDescription className="sr-only">Choose your withdrawal {picker}.</DialogDrawerDescription></DialogDrawerHeader><Input autoFocus aria-label={`Search ${picker}s`} placeholder={`Search ${picker}s`} value={search} onChange={e => setSearch(e.target.value)} />{filtered.length > 0 && <p className="text-muted-foreground">{picker === "token" ? "Token" : "Network"}</p>}<div className="-mx-2 max-h-80 space-y-1 overflow-y-auto">{filtered.map(a => picker === "token" ? <TokenChoiceRow key={a.assetId} asset={a} label={displaySymbol(a)}
      selected={!!token && depositTokenKey(a) === depositTokenKey(token)} onSelect={() => {
        feedback(); setTokenId(a.assetId); setDestinationId(""); setSourceId(""); setAmount(""); setQuoteError(false); setPicker(null);
      }} /> : <Button key={a.assetId} variant="ghost" className="h-auto min-h-12 w-full justify-start rounded-[6px] border-0 px-2 transition-none hover:bg-hover hover:text-foreground focus-visible:bg-hover dark:hover:bg-hover" onClick={() => { feedback(); setDestinationId(a.assetId); setWallet(""); setError(""); setQuoteError(false); setPicker(null); }}>
      <NetworkMark network={a.blockchain} /><span className="min-w-0 flex-1 text-left">{networkName(a.blockchain)}{variants.filter(v => v.blockchain === a.blockchain).length > 1 && <span className="block break-all text-xs text-muted-foreground">{a.contractAddress ?? a.assetId}</span>}</span>{a.assetId === destinationId && <Check />}</Button>)}{!filtered.length && <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">{search.trim() ? `No matching ${picker}s` : `No ${picker}s available`}</p>}</div></section>;
  }
  return <section className="min-w-0 space-y-4"><DialogDrawerHeader onBack={prepared ? () => setPrepared(null) : step === 3 ? () => setStep(2) : step === 2 ? () => setStep(1) : undefined} backLabel={prepared ? "Back to withdrawal details" : step === 3 ? "Back to recipient" : "Back to token and network"} backDisabled={busy}><DialogDrawerTitle>{prepared ? "Review withdrawal" : step === 2 ? `Address on ${destination ? networkName(destination.blockchain) : "network"}` : step === 3 ? "Enter amount" : "Withdraw"}</DialogDrawerTitle><DialogDrawerDescription className="sr-only">{"Send tokens to an external wallet."}</DialogDrawerDescription></DialogDrawerHeader>
    {(catalog.error || balances.error) && <Alert variant="destructive"><AlertDescription>Unable to refresh withdrawal data. <Button variant="outline" disabled={catalog.isFetching || balances.isFetching} onClick={() => { void catalog.refetch(); void balances.refetch(); }}>{(catalog.isFetching || balances.isFetching) && <LoaderCircle  aria-hidden="true" />}{catalog.isFetching || balances.isFetching ? "Retrying…" : "Retry"}</Button></AlertDescription></Alert>}
    {step > 1 && !destination && <Alert variant="destructive"><AlertDescription>Destination network is unavailable. Choose another network to continue. <Button variant="outline" disabled={busy} onClick={() => { setPrepared(null); setStep(1); }}>Choose network</Button></AlertDescription></Alert>}
    {step > 1 && destination && sourceId && !source && <Alert variant="destructive"><AlertDescription>Source network is unavailable. Choose another source balance to continue. {prepared && <Button variant="outline" disabled={busy} onClick={() => setPrepared(null)}>Choose source</Button>}</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {prepared ? <SendReview label="You receive" amount={prepared.review.expectedReceive} symbol={prepared.review.asset} estimated
      icon={destination && <AssetMark asset={destination} size={36} />}
      recipient={<RecipientAddress address={prepared.review.destinationWallet} network={destination?.blockchain} networkLabel={destination && networkName(destination.blockchain)} onCopyError={message => toast.error(message)} />}>

      <dl className="space-y-2"><div className="flex justify-between gap-2"><dt className="text-muted-foreground">You send</dt><dd title={prepared.review.amount}><FormattedNumber value={prepared.review.amount} symbol={prepared.review.asset} /></dd></div><div className="flex justify-between gap-2"><dt className="text-muted-foreground">Estimated conversion cost</dt><dd title={new D(prepared.review.amount).minus(prepared.review.expectedReceive).toFixed()}><FormattedNumber value={new D(prepared.review.amount).minus(prepared.review.expectedReceive).toFixed()} symbol={prepared.review.asset} /></dd></div>{"minimumReceive" in prepared.review && <><div className="flex justify-between gap-2"><dt className="text-muted-foreground">Minimum received</dt><dd title={prepared.review.minimumReceive}><FormattedNumber value={prepared.review.minimumReceive} symbol={prepared.review.asset} /></dd></div><div className="flex justify-between"><dt className="text-muted-foreground">Slippage tolerance</dt><dd>1%</dd></div></>}</dl>
      <p className="text-right text-xs text-muted-foreground tabular-nums">{expired ? "Quote expired" : `Quote expires in ${Math.floor(quoteSeconds / 60)}:${String(quoteSeconds % 60).padStart(2, "0")}`}</p><Button className="w-full" disabled={busy || !destination || !source || !!balances.error || (!expired && !prepared.options)} onClick={() => void (expired ? prepare() : confirm())}>{busy && <LoaderCircle  aria-hidden="true" />}{busy ? "Please wait…" : expired ? "Refresh quote" : prepared.options ? "Confirm withdrawal" : "Withdrawal unavailable"}</Button>
    </SendReview> : <>
      {step === 1 ? <><div className="space-y-2"><LabeledSelectTrigger label="Token" aria-label="Withdrawal token" value={token ? displaySymbol(token) : null} placeholder="Select token" icon={token && <AssetMark asset={token} size={36} />} disabled={!catalog.data} onClick={() => { setSearch(""); setPicker("token"); }} /><LabeledSelectTrigger label="Network" aria-label="Withdrawal network" value={destination ? networkName(destination.blockchain) : null} placeholder="Select network" icon={destination && <NetworkMark network={destination.blockchain} size={36} />} disabled={!token} onClick={() => { setSearch(""); setPicker("network"); }} /></div><Button className="w-full" disabled={!token || !destination || !!catalog.error} onClick={() => setStep(2)}>Next</Button></> : step === 2 ? <>
        <div className="space-y-2"><Label className="sr-only" htmlFor="withdraw-wallet">Address on {destination && networkName(destination.blockchain)}</Label><InputGroup><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon><InputGroupInput id="withdraw-wallet" autoFocus autoComplete="off" placeholder="Paste recipient address" value={wallet} onChange={e => { setWallet(e.target.value); setError(""); setQuoteError(false); }} /></InputGroup></div>
        {wallet.trim() && <Button variant="ghost" className="-mx-3 h-auto min-h-12 w-[calc(100%+1.5rem)] justify-start gap-3 border-0 px-3 hover:bg-hover hover:text-foreground focus-visible:bg-hover dark:hover:bg-hover" title={wallet.trim()} aria-label={`Select recipient ${wallet.trim()}`} onClick={() => selectRecipient(wallet)}>
          {destination && <NetworkMark network={destination.blockchain} />}<span>{shortenAddress(wallet.trim())}</span>
        </Button>}
        {!!recent.data?.filter(address => !wallet.trim() || address.includes(wallet.trim())).length && <div className="space-y-2"><p className="text-muted-foreground">Recent</p><div className="space-y-1">{recent.data.filter(address => !wallet.trim() || address.includes(wallet.trim())).map(address => <Button key={address} variant="ghost" className="-mx-3 h-auto min-h-12 w-[calc(100%+1.5rem)] justify-start gap-3 border-0 px-3 hover:bg-hover hover:text-foreground dark:hover:bg-hover" title={address} aria-label={`Recent recipient ${address}`} onClick={() => selectRecipient(address)}>{destination && <NetworkMark network={destination.blockchain} />}<span>{shortenAddress(address)}</span></Button>)}</div></div>}
        <Button className="w-full" disabled={!wallet.trim()} onClick={() => selectRecipient(wallet)}>Next</Button>
      </> : <>
        {(sourceChoices.length > 1 || (!source && sourceChoices.length > 0)) && <div className="space-y-2"><Label>Withdraw from</Label><Select items={sourceChoices.map(a => ({ value: a.assetId, label: `${networkName(a.blockchain)} balance` }))} value={source?.assetId ?? null} onValueChange={(value, details) => { if (!source && details.reason === "none") { details.cancel(); return; } if (value) { feedback(); setSourceId(value); setAmount(""); setQuoteError(false); } }}><SelectTrigger className="w-full" aria-label="Source balance"><SelectValue placeholder="Select source" /></SelectTrigger><SelectContent>{sourceChoices.map(a => <SelectItem key={a.assetId} value={a.assetId}>{networkName(a.blockchain)} balance</SelectItem>)}</SelectContent></Select></div>}
        <SendAmount id="withdraw-amount" symbol={token ? displaySymbol(token) : undefined}
          balance={balance} busy={busy} loading={balances.isPending} unavailable={!!balances.error}
          insufficient={insufficientBalance} amount={amount} onChange={value => { setAmount(value); setQuoteError(false); }} />
      <RecipientAddress address={wallet} network={destination?.blockchain} networkLabel={destination && networkName(destination.blockchain)} onCopyError={message => toast.error(message)} />
        {destination?.assetId === DEFAULT_PAIR.base.assetId && <p className="text-muted-foreground">Receives wrapped NEAR (wNEAR). The destination must be registered with wrap.near.</p>}
        {quoteError && <Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertDescription>Couldn’t get a quote. Try again.</AlertDescription></Alert>}
        <Button className="w-full" disabled={busy || !destination || !validAmount || !wallet.trim() || !!balances.error} onClick={() => void prepare()}>{busy && <LoaderCircle  aria-hidden="true" />}{busy ? "Getting quote…" : insufficientBalance ? "Insufficient balance" : quoteError ? "Try again" : "Review withdrawal"}</Button>
      </>}
    </>}
  </section>;
}
