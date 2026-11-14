"use client";
import { isConfirmationCancelled } from "@dya/ui/lib/is-confirmation-cancelled";
import { TOAST_MESSAGES } from "@dya/config";
import { toast } from "@dya/ui/lib/toast";
import { useEffect, useRef, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { LoaderCircle } from "@dya/ui/icons";
import { DialogHeader } from "@dya/ui/components/dialog";
import { Button } from "@dya/ui/components/button";
import { Input } from "@dya/ui/components/input";
import { Label } from "@dya/ui/components/label";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { ProviderWalletRecovery } from "./provider-wallet-recovery";
import { RecoveryId } from "./wallet-recovery-id";
import { connectRecoveryWallet, recoveryClient, type RecoveryWallet } from "../lib/recovery-client";

type RecoveryProps = { mode: "enroll" | "recover"; recoveryId?: string; onComplete: () => void | Promise<void>; onCancel: () => void; hideHeading?: boolean; onBusyChange?: (busy: boolean) => void; provider?: boolean };
export function WalletRecovery(props: RecoveryProps) {
  const key = JSON.stringify([props.mode, props.recoveryId ?? ""]);
  return props.provider ? <ProviderWalletRecovery key={key} {...props} /> : <LocalWalletRecovery key={key} {...props} />;
}

function LocalWalletRecovery({ mode, recoveryId: enrolledId = "", onComplete, onCancel, hideHeading = false, onBusyChange }: { mode: "enroll" | "recover"; recoveryId?: string; onComplete: () => void | Promise<void>; onCancel: () => void; hideHeading?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { mounted.current = true; heading.current?.focus(); return () => { mounted.current = false; }; }, []);
  const [recoveryId, setRecoveryId] = useState(enrolledId);
  const [wallet, setWallet] = useState<RecoveryWallet | null>(null);
  const [proof, setProof] = useState<{ message: string; expiresAt: number } | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState("");
  useEffect(() => { onBusyChange?.(!!busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const [error, setError] = useState("");
  const running = useRef(false);
  async function run(label: string, task: () => Promise<void>) {
    if (!mounted.current || running.current) return;
    running.current = true; setBusy(label); setError("");
    try { await task(); }
    catch (e) {
      if (!mounted.current) return;
      setProof(null); setWallet(null);
      if (isConfirmationCancelled(e)) toast(TOAST_MESSAGES.confirmationCancelled);
      else setError(e instanceof Error ? e.message : "Confirmation failed. Start again.");
    } finally { running.current = false; if (mounted.current) setBusy(""); }
  }
  const enrolling = mode === "enroll";
  async function advance() {
    if (!mounted.current) return;
    if (!wallet) {
      const connected = await connectRecoveryWallet();
      if (!mounted.current) return;
      setWallet(connected); return;
    }
    if (!proof) {
      if (enrolling) {
        const options = await recoveryClient.authorize(wallet.address, wallet.chainId);
        if (!mounted.current) return;
        const assertion = await startAuthentication({ optionsJSON: options });
        if (!mounted.current) return;
        const next = await recoveryClient.approve(assertion);
        if (!mounted.current) return;
        setProof(next);
      } else {
        const options = await recoveryClient.register(recoveryId.trim(), wallet.address, wallet.chainId);
        if (!mounted.current) return;
        const registration = await startRegistration({ optionsJSON: options });
        if (!mounted.current) return;
        const next = await recoveryClient.replacement(registration);
        if (!mounted.current) return;
        setProof(next);
      }
      return;
    }
    if (Date.now() >= proof.expiresAt) throw new Error("Recovery request expired. Start again.");
    const signature = await wallet.sign(proof.message);
    if (!mounted.current) return;
    if (Date.now() >= proof.expiresAt) throw new Error("Recovery request expired. Start again.");
    if (enrolling) {
      const result = await recoveryClient.enroll(signature);
      if (!mounted.current) return;
      setRecoveryId(result.recoveryId);
    } else {
      await recoveryClient.recover(signature);
      if (!mounted.current) return;
      try { localStorage.removeItem("dya-id:credential:v1"); } catch { /* Public hint only. */ }
    }
    setDone(true);
  }
  return <div className="space-y-4">
    {!hideHeading && <DialogHeader className="mx-0 first:mt-0 rounded-none" onBack={onCancel} backLabel="Back" backDisabled={!!busy}><h2 ref={heading} tabIndex={-1}>{done ? enrolling ? "Recovery wallet enrolled" : "Account access restored" : enrolling ? "Add recovery wallet" : "Recover account"}</h2></DialogHeader>}
    <Alert><AlertDescription>Local test only. Wallet authority is simulated and live funds are disabled. This does not enable recovery of a funded wallet.</AlertDescription></Alert>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {done ? <><p role="status">{enrolling ? "Save your recovery ID. Sign out, then use Recover account with this wallet and a new passkey." : "Your replacement passkey is active. Old sessions and the previous passkey are revoked locally."}</p>{enrolling && <RecoveryId value={recoveryId} />}<Button className="w-full" disabled={!!busy} onClick={() => void run("Continuing…", async () => { await onComplete(); })}>{busy && <LoaderCircle  />}{busy || "Done"}</Button></> : <>
      {enrolling ? <><p className="text-sm">A recovery wallet will have full control of your wallet, including moving all funds and managing its keys. Use a wallet you secure as carefully as your passkey.</p><RecoveryId value={recoveryId} /></> : <div className="space-y-2"><Label htmlFor="recovery-id">Recovery ID</Label><Input id="recovery-id" value={recoveryId} disabled={!!busy || !!wallet} onChange={e => setRecoveryId(e.target.value)} autoComplete="off" placeholder="Saved during enrollment" /><p className="text-sm text-muted-foreground">Use your enrolled Ethereum wallet. You don’t need your previous passkey.</p></div>}
      {wallet && <p className="break-all text-sm">Connected wallet: {wallet.address}</p>}
      {proof && <><p className="text-sm">Review the message, then sign with your recovery wallet.</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border p-3 text-xs">{proof.message}</pre></>}
      <Button className="w-full" disabled={!!busy || (!enrolling && !recoveryId.trim())} onClick={() => void run(!wallet ? "Connecting…" : !proof ? enrolling ? "Approving…" : "Creating passkey…" : "Signing…", advance)}>{busy && <LoaderCircle  />}{busy || (!wallet ? "Connect recovery wallet" : !proof ? enrolling ? "Approve with passkey" : "Create replacement passkey" : enrolling ? "Sign and enroll" : "Sign and recover")}</Button>
    </>}
  </div>;
}
