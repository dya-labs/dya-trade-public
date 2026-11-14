"use client";
import { isConfirmationCancelled } from "@dya/ui/lib/is-confirmation-cancelled";
import { toast } from "@dya/ui/lib/toast";
import { DYA_BRAND, TOAST_MESSAGES } from "@dya/config";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, ScanFace } from "@dya/ui/icons";
import { useEffect, useRef, useState } from "react";
import { unlockBalances, passkeyError } from "@/lib/near/client/sign-in";
import { Button } from "@dya/ui/components/button";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { ConfidentialAccessRequired } from "@/lib/near/domain/confidential-access-error";
export function ConfidentialAccess({ panel = false }: { panel?: boolean }) {
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  async function unlock() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setMessage(""); setError("");
    try {
      if (!confirmed) {
        await unlockBalances(controller.signal);
        if (controller.signal.aborted) return;
        setConfirmed(true);
      }
      await client.invalidateQueries({ queryKey: ["near", "account"] });
      if (controller.signal.aborted) return;
      const failedBalance = client.getQueryCache().findAll({ queryKey: ["near", "account"], type: "active" })
        .find(query => query.queryKey.includes("balances") && query.state.error);
      if (failedBalance) throw failedBalance.state.error;
      setMessage("Balance access restored.");
    } catch (e) { if (!controller.signal.aborted) { if (e instanceof ConfidentialAccessRequired) setConfirmed(false); if (isConfirmationCancelled(e)) toast(TOAST_MESSAGES.confirmationCancelled); else setError(passkeyError(e)); } }
    finally { if (active.current === controller) active.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  let actionLabel = confirmed ? error ? "Retry balances" : "Refresh balances" : "Unlock balances";
  if (busy) actionLabel = confirmed ? "Refreshing…" : "Checking…";
  return <section className={panel ? "flex min-h-64 flex-col items-center justify-center gap-4 px-3 py-6 text-center" : "space-y-2"}>{panel && <ScanFace className="size-10" aria-hidden="true" />}<h3>Confidential balances</h3><p className="text-muted-foreground">Unlock your balances with {DYA_BRAND.idName}.</p>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{message && <p role="status">{message}</p>}<Button className={panel ? "w-full" : undefined} variant={panel ? "default" : "outline"} disabled={busy} onClick={() => void unlock()}>{busy && <LoaderCircle  aria-hidden="true" />}{actionLabel}</Button></section>;
}
