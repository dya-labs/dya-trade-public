"use client";
import { isConfirmationCancelled } from "@dya/ui/lib/is-confirmation-cancelled";
import { BrandLogo } from "@dya/ui/components/brand-logo";
import { DYA_BRAND, TOAST_MESSAGES } from "@dya/config";
import { useEffect, useRef, useState, useSyncExternalStore, lazy, Suspense } from "react";
import { startAuthentication, startRegistration, type PublicKeyCredentialRequestOptionsJSON, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { AccountWelcome } from "./account-welcome";
import { AccountNameForm, AccountSecurityIcon } from "./account-name-form";
import { Button } from "@dya/ui/components/button";
import { AccountAvatar } from "@dya/ui/components/account-avatar";
import { WalletFrame } from "./wallet-frame";
import { WalletReview } from "./wallet-review";
import { LabeledSeparator } from "@dya/ui/components/separator";
import { toast } from "@dya/ui/lib/toast";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { getRegistrationOptions, getLoginOptions, registerPasskey, loginPasskey, finishConnection, finishApproval, WalletRequestError } from "../lib/wallet-client";
import { LoaderCircle, LoginCircle, ScanFace, ShieldCheck, ArrowUpRight } from "@dya/ui/icons";
import type { ComponentProps } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WalletQueryProvider } from "@dya/wallet-ui/components/wallet-query-provider";
import { SignOutDialog } from "@dya/wallet-ui/components/sign-out-dialog";
import { getSession, logout } from "@dya/wallet-ui/lib/near/http/account-client";
import type { Snapshot } from "@dya/wallet-contracts/src/http/schemas/account";

const WalletRecovery = lazy(() => import("./wallet-recovery").then(module => ({ default: module.WalletRecovery })));

export function WalletFlow(props: ComponentProps<typeof WalletFlowContent>) {
  return <WalletQueryProvider><WalletFlowContent key={props.id} {...props} /></WalletQueryProvider>;
}

function WalletFlowContent({ id, kind, connectionKind, clientOrigin, callback, review, options, status, recoveryEnabled = false, providerRecovery = false, session, expiresAt, initialScreen, serverReadMs }: { id: string; kind: "connect" | "approval"; connectionKind?: "login" | "register"; clientOrigin: string; callback: string; review: unknown; options: unknown; status: string; recoveryEnabled?: boolean; providerRecovery?: boolean; session?: Snapshot; expiresAt?: number; initialScreen?: "recover"; serverReadMs?: number }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const client = useQueryClient();
  // Connect pages arrive with the server-rendered session, so this only refetches once stale.
  const sessionQuery = useQuery({ queryKey: ["near", "session"], queryFn: ({ signal }) => getSession(signal), enabled: kind === "connect", initialData: session, staleTime: 30000, retry: false });
  const [welcoming, setWelcoming] = useState(false);
  const [naming, setNaming] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [recovering, setRecovering] = useState(initialScreen === "recover" && kind === "connect" && recoveryEnabled && status === "pending");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [connectingAs, setConnectingAs] = useState<boolean | null>(null);
  const [compatibility, setCompatibility] = useState(false), [restart, setRestart] = useState(false), [settled, setSettled] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [approvalSubmitted, setApprovalSubmitted] = useState(false);
  const [approvalCancelled, setApprovalCancelled] = useState(false);
  const [connectionCode, setConnectionCode] = useState<string>();
  const isEmbedded = useSyncExternalStore(() => () => {}, () => window.parent !== window, () => false);
  const details = review as { title?: string; account?: string; details?: Record<string, unknown> } | undefined;
  const deadlines = kind === "approval" ? [expiresAt, details?.details?.expires].filter(value => value !== undefined) : [];
  const parsedDeadline = deadlines.length ? Math.min(...deadlines.map(value => typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN)) : null;
  const deadline = parsedDeadline !== null && !Number.isFinite(parsedDeadline) ? 0 : parsedDeadline;
  const expired = status === "expired" || (!approvalSubmitted && deadline !== null && now >= deadline);
  useEffect(() => {
    if (deadline === null || approvalSubmitted || expired) return;
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(initial);window.clearInterval(timer); };
  }, [deadline, approvalSubmitted, expired]);
  const embedded = () => window.parent !== window;
  useEffect(() => {
    const receiver = window.parent !== window ? window.parent : window.opener;
    if (!receiver) return;
    const navigation = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    receiver.postMessage({ type: "dya:ready", flowId: id, documentReadyMs: Math.round(performance.now()), responseMs: navigation?.responseEnd, serverReadMs }, clientOrigin);
  }, [id, clientOrigin, serverReadMs]);
  useEffect(() => { if (window.parent !== window) window.parent.postMessage({ type: "dya:busy", flowId: id, busy }, clientOrigin); }, [busy, id, clientOrigin]);
  function platformFallback(e: unknown) {
    if (embedded() && e && typeof e === "object" && "name" in e && (["SecurityError", "NotSupportedError"].includes(String(e.name)) || ("message" in e && String(e.message).includes("sameOriginWithAncestors")))) { setCompatibility(true); setError("Your browser cannot use passkeys here. Continue in a wallet popup."); return true; }
    return false;
  }
  function finish(code?: string) {
    if (!mounted.current) return;
    const receiver = embedded() ? window.parent : window.opener;
    if (receiver) receiver.postMessage({ type: "dya:complete", flowId: id, ...(code ? { code } : {}) }, clientOrigin);
    else { const target = new URL(callback); target.searchParams.set("flowId", id); if (code) target.searchParams.set("code", code); window.location.assign(target.href); }
  }
  function explain(e: unknown) {
    if (e && typeof e === "object" && "name" in e && e.name === "NotAllowedError") return "Passkey confirmation was cancelled. Try again when you’re ready.";
    return "Could not confirm this request. Return to Terminal and start a new request.";
  }
  async function signOut() {
    if (!mounted.current || busy) return;
    setBusy(true); setConnectingAs(null); setSignOutError("");
    try {
      await logout();
      if (!mounted.current) return;
      await client.cancelQueries({ queryKey: ["near", "account"] });
      if (!mounted.current) return;
      client.removeQueries({ queryKey: ["near", "account"] });
      await client.cancelQueries({ queryKey: ["near", "session"] });
      if (!mounted.current) return;
      client.setQueryData(["near", "session"], sessionQuery.data ? { ...sessionQuery.data, account: null } : null);
      setError("");
      setSignOutOpen(false);
    } catch (e) {
      if (!mounted.current) return;
      setSignOutError(e instanceof WalletRequestError ? e.message : "Could not sign out. Try again.");
    } finally { if (mounted.current) setBusy(false); }
  }
  async function completeConnection() {
    if (!mounted.current) return;
    const result = await finishConnection(id);
    if (!mounted.current) return;
    setConnectionCode(result.code);setSettled(true);setRecovering(false);setNaming(false);setError("");
    finish(result.code);
  }
  async function connect(register: boolean, name?: string) {
    if (!mounted.current || busy || settled || status !== "pending") return;
    if (register && !name) { setWelcoming(true); setError(""); return; }
    setConnectingAs(register);
    setBusy(true); setError("");
    try {
      if (register) {
        const opts = await getRegistrationOptions(name!);
        if (!mounted.current) return;
        const assertion = await startRegistration({ optionsJSON: opts });
        if (!mounted.current) return;
        await registerPasskey(assertion);
        if (!mounted.current) return;
        try { localStorage.setItem("dya-id:credential:v1", assertion.id); } catch { /* Public hint only. */ }
      } else {
        let credentialId: string | undefined;
        try { credentialId = localStorage.getItem("dya-id:credential:v1") || undefined; } catch { /* Storage restrictions use discovery. */ }
        const opts = await getLoginOptions(credentialId);
        if (!mounted.current) return;
        const assertion = await startAuthentication({ optionsJSON: opts });
        if (!mounted.current) return;
        await loginPasskey(assertion);
        if (!mounted.current) return;
        try { localStorage.setItem("dya-id:credential:v1", assertion.id); } catch { /* Public hint only. */ }
      }
      await completeConnection();
    } catch (e) { if (!mounted.current) return; if (!register) { try { localStorage.removeItem("dya-id:credential:v1"); } catch { /* Storage may be disabled. */ } } if (isConfirmationCancelled(e)) toast(TOAST_MESSAGES.confirmationCancelled); else if (!platformFallback(e)) setError(e instanceof WalletRequestError ? e.message : "Could not connect. Try signing in again or create a wallet."); }
    finally { setBusy(false); }
  }
  async function approve() {
    if (!mounted.current || busy || approvalSubmitted || status !== "pending" || stopExpiredApproval()) return;
    setBusy(true); setError("");
    let submitted = false;
    try {
      const registration = options && typeof options === "object" && "rp" in options;
      const assertion = registration ? await startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON }) : await startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON });
      if (!mounted.current || stopExpiredApproval()) return;
      submitted = true;
      setApprovalSubmitted(true);
      const result = await finishApproval(id, assertion);
      if (!mounted.current) return;
      setSettled(true);
      if (result.status >= 400) { setError("The wallet could not complete this operation. Return to Terminal to check its status."); }
      else finish();
    } catch (e) {
      if (!mounted.current) return;
      if (!submitted && isConfirmationCancelled(e)) {
        setApprovalCancelled(true); toast(TOAST_MESSAGES.confirmationCancelled);
      } else if (!platformFallback(e)) { setError(explain(e)); setRestart(submitted); }
    }
    finally { setBusy(false); }
  }
  function stopExpiredApproval() {
    if (deadline === null || Date.now() < deadline) return false;
    setNow(Date.now());setError("");return true;
  }
  function fallback(screen?: "recover") { if (embedded()) window.parent.postMessage({ type: "dya:fallback", flowId: id, ...(screen ? { screen } : {}) }, clientOrigin); }
  function cancel() { const receiver = embedded() ? window.parent : window.opener; if (receiver) { receiver.postMessage({ type: "dya:cancel", flowId: id }, clientOrigin); } else window.location.assign(new URL("/", clientOrigin).href); }
  const account = kind === "connect" && !recovering ? sessionQuery.data?.account : undefined;
  const title = welcoming ? `Welcome to ${DYA_BRAND.idName}` : naming ? "Name your account" : account ? `Continue with ${DYA_BRAND.idName}` : recovering ? "Recover account" : kind === "connect" ? (connectionKind === "register" ? "Create account" : "Get started") : details?.title === "Review funding conversion" ? "Confirm transfer" : details?.title === "Fund limit order" ? (details.details?.side === "sell" ? "Review limit sell" : "Review limit buy") : details?.title === "Review market trade" ? (details.details?.side === "sell" ? "Review sell" : "Review buy") : details?.title || "Confirm wallet action";
  const quoteExpired = expired && !approvalSubmitted && (details?.title === "Review market trade" || details?.title === "Fund limit order");
  function reviewAgain() { const receiver = embedded() ? window.parent : window.opener; if (receiver) receiver.postMessage({ type: "dya:retry", flowId: id }, clientOrigin); else window.location.assign(new URL("/", clientOrigin).href); }
  const pending = status === "pending" && !expired && !restart && !settled;
  const action = details?.title === "Fund limit order" ? approvalCancelled ? "Try again" : details.details?.side === "sell" ? "Confirm limit sell" : "Confirm limit buy" : details?.title === "Review funding conversion" ? approvalCancelled ? "Try again" : "Confirm transfer" : details?.title === "Unlock confidential balances" ? "Unlock balances" : details?.title === "Review withdrawal" ? "Confirm withdrawal" : details?.title === "Review market trade" ? (details.details?.side === "sell" ? "Confirm sell" : "Confirm buy") : "Confirm with passkey";
  return <div data-wallet-embedded={isEmbedded}><WalletFrame embedded={isEmbedded} requester={new URL(clientOrigin).host} title={title} headingLayout={(details?.title === "Review market trade" || details?.title === "Fund limit order") ? "compact" : "centered"} icon={naming ? <AccountSecurityIcon /> : welcoming ? <BrandLogo size={16} name={DYA_BRAND.idName} /> : account ? <div className="flex flex-col items-center gap-2"><AccountAvatar seed={account.intentsIdentity?.accountId ?? account.id} size="lg" />{account.name && <p className="max-w-full break-words text-sm font-medium">{account.name}</p>}</div> : kind === "connect" ? <LoginCircle className="size-12" aria-hidden="true" /> : details?.title === "Unlock confidential balances" ? <ScanFace className="size-12" aria-hidden="true" /> : details?.title?.includes("backup") ? <ShieldCheck className="size-12" aria-hidden="true" /> : (details?.title === "Review funding conversion" || details?.title === "Review market trade" || details?.title === "Fund limit order") ? undefined : <ArrowUpRight className="size-12" aria-hidden="true" />} busy={busy || recoveryBusy} onBack={recovering ? () => setRecovering(false) : undefined} onCancel={cancel}>
    {!recovering && (kind === "connect" ? !welcoming && !naming && !account && connectionKind !== "register" && <p className="text-center text-muted-foreground">Sign in with your {DYA_BRAND.accountName} to use {DYA_BRAND.name}.</p> : <WalletReview review={details} now={now} />)}

    {error && !expired && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {!pending && (!error || expired) && <p role="status" className="text-muted-foreground">{quoteExpired ? details?.title === "Fund limit order" ? TOAST_MESSAGES.confirmationExpired : TOAST_MESSAGES.quoteExpired : expired ? "This request expired. Return to Terminal and start again." : settled && kind === "connect" ? "Connection approved. Return to Terminal to continue." : "This request has already started. Return to Terminal and check its status."}</p>}
    {welcoming ? <AccountWelcome onContinue={() => { setWelcoming(false); setNaming(true); }} /> : naming ? <AccountNameForm busy={busy} onSubmit={name => void connect(true, name)} /> : recovering ? <Suspense fallback={<p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading recovery…</p>}><WalletRecovery provider={providerRecovery} mode="recover" hideHeading onBusyChange={setRecoveryBusy} onCancel={() => setRecovering(false)} onComplete={completeConnection} /></Suspense> : pending && !compatibility ? kind === "connect" ? account ? <div className="space-y-2"><Button className="w-full" disabled={busy} onClick={() => void connect(false)}>{busy && <LoaderCircle  />}{busy ? "Continuing…" : "Continue"}</Button><Button className="w-full" variant="outline" disabled={busy} onClick={() => { setSignOutError(""); setSignOutOpen(true); }}>Switch account</Button></div> : <div className="space-y-4"><Button className="w-full" disabled={busy} onClick={() => void connect(connectionKind === "register")}>{busy && connectingAs === (connectionKind === "register") ? <LoaderCircle  /> : <LoginCircle />}{busy && connectingAs === (connectionKind === "register") ? connectingAs ? "Creating…" : "Signing in…" : connectionKind === "register" ? "Create account" : "Sign in"}</Button><LabeledSeparator>{connectionKind === "register" ? "Already have an account?" : "First time here?"}</LabeledSeparator><Button className="w-full" variant="outline" disabled={busy} onClick={() => void connect(connectionKind !== "register")}>{busy && connectingAs !== (connectionKind === "register") && <LoaderCircle  />}{busy && connectingAs !== (connectionKind === "register") ? connectingAs ? "Creating…" : "Signing in…" : connectionKind === "register" ? "Sign in" : "Create account"}</Button>{recoveryEnabled && <p className="text-center text-sm text-muted-foreground">Trouble signing in? <Button variant="link" className="h-auto p-0" disabled={busy} onClick={() => { if (embedded()) fallback("recover"); else setRecovering(true); }}>Recover</Button></p>}</div> : <Button className="w-full" disabled={busy} onClick={() => void approve()}>{busy && <LoaderCircle  />}{busy ? "Confirming…" : action}</Button> : compatibility && !expired ? <Button className="w-full" onClick={() => fallback()}>Continue in popup</Button> : <Button className="w-full" disabled={busy} onClick={() => quoteExpired ? reviewAgain() : settled ? finish(connectionCode) : cancel()}>{quoteExpired ? "Review again" : "Return to Terminal"}</Button>}
  </WalletFrame><SignOutDialog intent="switch-account" open={signOutOpen} onOpenChange={setSignOutOpen} busy={busy} error={signOutError} onConfirm={() => void signOut()} /></div>;
}
