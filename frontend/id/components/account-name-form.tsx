"use client";

import { useId, useState } from "react";
import { LoaderCircle, ScanFace } from "@dya/ui/icons";
import { Button } from "@dya/ui/components/button";
import { InputGroup, InputGroupInput } from "@dya/ui/components/input-group";
import { Label } from "@dya/ui/components/label";
import { accountName } from "@dya/wallet-contracts/src/http/schemas/account";

/** Private account label collected before starting the passkey ceremony. */
export function AccountNameForm({ busy, onSubmit }: { busy: boolean; onSubmit: (name: string) => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const parsed = accountName.safeParse(name || "Personal");
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!busy && parsed.success) onSubmit(parsed.data); }}>
    <p id={`${id}-help`} className="text-center text-sm text-muted-foreground">Only visible to you.</p>
    <InputGroup>
      <Label htmlFor={id} className="sr-only">Name</Label>
      <InputGroupInput id={id} placeholder="Personal" value={name} onChange={event => setName(event.target.value.replace(/\s/gu, ""))} maxLength={64} disabled={busy} autoFocus autoComplete="off" aria-describedby={`${id}-help`} />
    </InputGroup>
    <Button type="submit" className="w-full" disabled={busy || !parsed.success}>{busy && <LoaderCircle  />}{busy ? "Creating…" : "Create account"}</Button>
  </form>;
}

export function AccountSecurityIcon() {
  return <ScanFace className="size-12" aria-hidden="true" />;
}
