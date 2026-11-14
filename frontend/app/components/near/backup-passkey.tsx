"use client";
import { isConfirmationCancelled } from "@dya/ui/lib/is-confirmation-cancelled";
import { TOAST_MESSAGES } from "@dya/config";
import { toast } from "@dya/ui/lib/toast";
import { backupAuthorizationOptions, backupRegistrationOptions, backupTestOptions, verifyBackupAuthorization, verifyBackupRegistration, verifyBackupTest } from "@/lib/near/http/account-client";
import { useEffect, useRef, useState } from "react";
import { startAuthentication, startRegistration } from "@dya/wallet-sdk";
import { passkeyError } from "@/lib/near/client/sign-in";
import { LoaderCircle } from "@dya/ui/icons";
import type { Snapshot } from "@/lib/near/http/schemas/account";
import { Button } from "@dya/ui/components/button";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
type BackupPasskeyProps = { account: Snapshot["account"]; refresh: () => Promise<void> };
export function BackupPasskey(props: BackupPasskeyProps) {
  return <BackupPasskeyForm key={props.account?.id ?? "signed-out"} {...props} />;
}
function BackupPasskeyForm({ account, refresh }: BackupPasskeyProps) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);
  const [tested, setTested] = useState(false);
  async function setup() {
    if (!mounted.current) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if ((account?.backupEnrollmentUntil ?? 0) <= Date.now()) {
        const approval = await backupAuthorizationOptions();
        if (!mounted.current) return;
        const assertion = await startAuthentication({ optionsJSON: approval });
        if (!mounted.current) return;
        await verifyBackupAuthorization(assertion);
        if (!mounted.current) return;
      }
      const options = await backupRegistrationOptions();
      if (!mounted.current) return;
      const registration = await startRegistration({ optionsJSON: options });
      if (!mounted.current) return;
      await verifyBackupRegistration(registration);
      if (!mounted.current) return;
      setSaved(true); setNotice("Backup saved locally. Test it next. On-chain authorization is still required.");
      await refresh();
    } catch(e) { if (isConfirmationCancelled(e)) toast(TOAST_MESSAGES.confirmationCancelled); else setError(passkeyError(e)); }
    finally { setBusy(false); }
  }
  async function test() {
    if (!mounted.current) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const options = await backupTestOptions();
      if (!mounted.current) return;
      const assertion = await startAuthentication({ optionsJSON: options });
      if (!mounted.current) return;
      await verifyBackupTest(assertion);
      if (!mounted.current) return;
      setTested(true); setNotice("Backup possession verified locally. Recovery is not active yet.");
      await refresh();
    } catch(e) { if (isConfirmationCancelled(e)) toast(TOAST_MESSAGES.confirmationCancelled); else setError(passkeyError(e)); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3">
    <h3>Backup passkey</h3>
    <p>Create a backup on a separate device or security key. First approve setup with your current passkey, then choose where to save the backup.</p>
    <Alert><AlertDescription>Local setup only. The backup cannot sign in or control funds until authorized on-chain. Keep your primary passkey. Recovery is not active.</AlertDescription></Alert>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{notice && <p role="status">{notice}</p>}
    {account?.backup || saved ? <><p>{account?.backup?.testedAt || tested ? "Backup tested locally · Pending on-chain authorization" : "Backup saved · Test required"}</p><Button disabled={busy} variant="outline" onClick={() => void test()}>{busy && <LoaderCircle  aria-hidden="true" />}{busy ? "Waiting for passkey…" : "Test backup passkey"}</Button></> : <Button disabled={busy || account?.kind !== "passkey"} onClick={() => void setup()}>{busy && <LoaderCircle  aria-hidden="true" />}{busy ? "Waiting for passkey…" : (account?.backupEnrollmentUntil ? "Continue backup setup" : "Set up backup passkey")}</Button>}
  </section>;
}
