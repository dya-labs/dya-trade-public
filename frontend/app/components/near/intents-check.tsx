"use client";
import { prepareSigningCheck, verifySigningCheck } from "@/lib/near/http/account-client";
import { useRef, useState } from "react";
import { startAuthentication } from "@dya/wallet-sdk";
import type { Snapshot } from "@/lib/near/http/schemas/account";
import type { SigningCheck } from "@/lib/near/auth/intents";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@dya/ui/components/card";
import { Button } from "@dya/ui/components/button";
import { Badge } from "@dya/ui/components/badge";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
export function IntentsCheck({
  account,
  refresh,
}: {
  account: Snapshot["account"];
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SigningCheck | null>(null);
  const running = useRef(false);
  const check = result ?? account?.signingCheck;
  async function verify() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const prepared = await prepareSigningCheck();
      const assertion = await startAuthentication({
        optionsJSON: prepared.options,
      });
      const verified = await verifySigningCheck(assertion);
      setResult(verified.result);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Signing check failed. Try again.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Intents signing</h2>
        </CardTitle>
        <CardDescription>
          Check your passkey against the NEAR Intents verifier.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {account?.intentsIdentity && (
          <details>
            <summary>Derived Intents account</summary>
            <p className="break-all pt-2">
              {account.intentsIdentity.accountId}
            </p>
            <CardDescription>
              Derived from this passkey. Deposits remain disabled.
            </CardDescription>
          </details>
        )}
        <CardDescription>
          This signs an empty intent list and sends its public key and proof to
          NEAR’s public RPC for a read-only check. No transfers, key changes, or
          transaction submission.
        </CardDescription>
        <Button
          className="w-full"
          variant="outline"
          disabled={account?.kind !== "passkey" || busy}
          onClick={verify}
        >
          {busy ? "Checking signature…" : "Check Intents signing"}
        </Button>
        {account?.kind !== "passkey" && (
          <CardDescription>
            Connect a passkey to run this check.
          </CardDescription>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {check && (
          <div role="status" className="space-y-2">
            <Badge variant="secondary">
              {check.status === "verified"
                ? "Verifier confirmed"
                : "Local signature only"}
            </Badge>
            <p>{check.message}</p>
            <CardDescription>
              {new Date(check.checkedAt).toLocaleString()}
              {check.blockHeight ? ` · Block ${check.blockHeight}` : ""}
            </CardDescription>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
