"use client";
import { isConfirmationCancelled } from "@dya/ui/lib/is-confirmation-cancelled";
import { TOAST_MESSAGES } from "@dya/config";
import { toast } from "@dya/ui/lib/toast";
import { useEffect, useRef, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { LoaderCircle } from "@dya/ui/icons";
import { DialogHeader } from "@dya/ui/components/dialog";
import { Button } from "@dya/ui/components/button";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { authenticationOptions, registrationOptions } from "../../../packages/wallet-contracts/src/http/schemas/account";
import { connectRecoveryWallet, providerRecoveryClient, type RecoveryWallet, type ProviderRecoveryStep } from "../lib/recovery-client";
const labels: Record<string, string> = {
  recover_discover: "Find my accounts", enroll_ownership: "Confirm recovery wallet", enroll_key: "Authorize recovery key", enroll_auth: "Verify confidential access",
  recover_register: "Create replacement passkey", recover_resume: "Resume recovery", recover_add: "Authorize replacement key", recover_test: "Test replacement passkey", recover_remove: "Revoke previous keys", recover_finish: "Finish with new passkey",
};
type ProviderRecoveryProps = { mode: "enroll" | "recover"; recoveryId?: string; onComplete: () => void | Promise<void>; onCancel: () => void; hideHeading?: boolean; onBusyChange?: (busy: boolean) => void };
export function ProviderWalletRecovery(props: ProviderRecoveryProps) {
  return <ProviderWalletRecoveryForm key={JSON.stringify([props.mode, props.recoveryId ?? ""])} {...props} />;
}
function ProviderWalletRecoveryForm({ mode, recoveryId: initialId = "", onComplete, onCancel, hideHeading = false, onBusyChange }: ProviderRecoveryProps) {
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { mounted.current = true; heading.current?.focus(); return () => { mounted.current = false; }; }, []);
  const [selectedId, setSelectedId] = useState(initialId);
  const [wallet, setWallet] = useState<RecoveryWallet | null>(null);
  const [step, setStep] = useState<ProviderRecoveryStep | null>(null);
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  useEffect(() => { onBusyChange?.(!!busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const running = useRef(false);
  const enroll = mode === "enroll", complete = step?.phase === "complete", pending = !!step?.pending || step?.phase.endsWith("_pending"), rejected = step?.phase === "rejected";
  const selectedAccountAvailable = !!step?.accounts?.some(account => account.id === selectedId);
  async function run(label: string, task: () => Promise<void>) {
    if (!mounted.current || running.current) return; running.current = true; setBusy(label); setError("");
    try { await task(); }
    catch (e) { if (mounted.current) { if (isConfirmationCancelled(e)) toast(TOAST_MESSAGES.confirmationCancelled); else setError(e instanceof Error ? e.message : "Recovery could not continue. Check status before trying again."); } }
    finally { running.current = false; if (mounted.current) setBusy(""); }
  }
  function acceptStep(next: ProviderRecoveryStep) {
    if (!mounted.current) return;
    if (next.phase === "complete") { try { localStorage.removeItem("dya-id:credential:v1"); } catch { /* Public credential hint only. */ } }
    setStep(next);
  }
  async function advance() {
    if (!mounted.current) return;
    if (!wallet) {
      const connected = await connectRecoveryWallet();
      if (!mounted.current) return;
      setWallet(connected);
      acceptStep(enroll ? await providerRecoveryClient.enroll(connected.address, connected.chainId) : await providerRecoveryClient.discover(connected.address, connected.chainId));
      return;
    }
    if (!step) { acceptStep(enroll ? await providerRecoveryClient.enroll(wallet.address, wallet.chainId) : await providerRecoveryClient.discover(wallet.address, wallet.chainId)); return; }
    if (step.phase === "recover_select") { if (!selectedAccountAvailable) return;acceptStep(await providerRecoveryClient.select(selectedId)); return; }
    if (pending) { acceptStep(await providerRecoveryClient.status()); return; }
    if (step.expiresAt !== undefined && Date.now() >= step.expiresAt) { acceptStep(await providerRecoveryClient.status()); return; }
    const proof = step.phase === "recover_register"
      ? await startRegistration({ optionsJSON: registrationOptions.parse(step.options) })
      : step.options ? await startAuthentication({ optionsJSON: authenticationOptions.parse(step.options) })
      : { signature: await wallet.sign(step.message!) };
    if (!mounted.current) return;
    if (step.expiresAt !== undefined && Date.now() >= step.expiresAt) { acceptStep(await providerRecoveryClient.status()); return; }
    const next = await providerRecoveryClient.advance(step.phase, proof);
    if (!mounted.current) return;
    acceptStep(next);
    if (next.phase === "recover_select" && next.accounts?.length === 1) { setSelectedId(next.accounts[0].id); acceptStep(await providerRecoveryClient.select(next.accounts[0].id)); } else { setSelectedId(""); }
  }
  return <div className="space-y-4">
    {!hideHeading && <DialogHeader className="mx-0 first:mt-0 rounded-none" onBack={onCancel} backLabel="Back" backDisabled={!!busy}><h2 ref={heading} tabIndex={-1}>{complete ? enroll ? "Recovery wallet verified" : "Wallet recovered" : enroll ? "Add recovery wallet" : "Recover wallet"}</h2></DialogHeader>}
    {!complete && <p className="text-sm">The recovery wallet has full control of your funds and keys. Enrollment is ready only after on-chain authorization and confidential access are verified.</p>}
    {!enroll && !complete && <p className="text-sm text-muted-foreground">Connect your enrolled Ethereum wallet to find your account. No recovery ID is needed. When resuming, use the replacement passkey you already created.</p>}
    {step?.phase === "recover_select" && <div className="space-y-2">{step.accounts?.length ? <><p>Choose an account to recover.</p>{step.accounts.map(account => <Button key={account.id} className="w-full" variant={selectedId === account.id ? "default" : "outline"} disabled={!!busy} onClick={() => setSelectedId(account.id)} aria-pressed={selectedId === account.id}>{account.label}</Button>)}</> : <p>No accounts are linked to this recovery wallet. Go back and connect the wallet you enrolled.</p>}</div>}
    {wallet && <p className="break-all text-sm">Recovery wallet: {wallet.address}</p>}
    {pending && <Alert><AlertDescription>Key change awaiting confirmation. Check status before starting another request.</AlertDescription></Alert>}
    {step?.phase === "recover_test" && <p>Confirm confidential access with your replacement passkey before revoking the previous keys.</p>}
    {step?.phase === "recover_remove" && <Alert><AlertDescription>Your replacement passkey accessed the original confidential wallet. This signature revokes the previous primary and pending backup keys.</AlertDescription></Alert>}
    {step?.message && !complete && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border p-3 text-xs">{step.message}</pre>}
    {complete && <p role="status">{enroll ? "On-chain authorization and confidential access are verified. Recover by connecting this Ethereum wallet; no recovery ID is needed." : "The new passkey accessed your original confidential wallet. Previous keys are revoked on-chain, and old app sessions are invalidated."}</p>}
    {(error || step?.error || rejected) && <Alert variant="destructive"><AlertDescription>{error || step?.error || "Provider rejected the key change. Recovery has not completed."}</AlertDescription></Alert>}
    {complete ? <Button className="w-full" disabled={!!busy} onClick={() => void run("Continuing…", async () => { await onComplete(); })}>{busy && <LoaderCircle  />}{busy || "Done"}</Button> : <>
      <Button className="w-full" disabled={!!busy || rejected || (step?.phase === "recover_select" && !selectedAccountAvailable)} onClick={() => void run(pending ? "Checking…" : "Confirming…", advance)}>{busy && <LoaderCircle  />}{busy || (!wallet || !step ? "Connect recovery wallet" : pending ? "Check status" : labels[step.phase] || "Continue")}</Button>
      {step && !pending && !rejected && <Button className="w-full" variant="outline" disabled={!!busy} onClick={() => void run("Checking…", async () => { acceptStep(await providerRecoveryClient.status()); })}>{busy === "Checking…" && <LoaderCircle  />}Check status</Button>}
    </>}
  </div>;
}
