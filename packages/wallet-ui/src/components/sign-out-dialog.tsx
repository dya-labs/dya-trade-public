"use client";

import { DYA_BRAND } from "@dya/config";
import { LoaderCircle } from "@dya/ui/icons";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { AlertDialogDrawer, AlertDialogDrawerContent, AlertDialogDrawerDescription, AlertDialogDrawerFooter, AlertDialogDrawerHeader, AlertDialogDrawerTitle, AlertDialogDrawerCancel, AlertDialogDrawerAction, AlertDialogDrawerBody } from "@dya/ui/components/alert-dialog-drawer";

/** Sign-out confirmation shared by DYA ID and Terminal; it stays open and locked while signing out. */
export function SignOutDialog({ open, onOpenChange, busy, error, onConfirm, intent = "sign-out" }: { open: boolean; onOpenChange: (open: boolean) => void; busy: boolean; error?: string; onConfirm: () => void; intent?: "sign-out" | "switch-account" }) {
  const switching = intent === "switch-account";
  return <AlertDialogDrawer open={open} busy={busy} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <AlertDialogDrawerContent>
      <AlertDialogDrawerHeader><AlertDialogDrawerTitle>{switching ? "Switch account?" : "Sign out?"}</AlertDialogDrawerTitle><AlertDialogDrawerDescription className="sr-only">{switching ? `Confirm switching your ${DYA_BRAND.accountName}.` : `Confirm signing out of your ${DYA_BRAND.accountName}.`}</AlertDialogDrawerDescription></AlertDialogDrawerHeader>
      {(switching || error) && <AlertDialogDrawerBody>{switching && <p className="text-sm text-muted-foreground">You’ll sign out of {DYA_BRAND.idName}, then choose another account.</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}</AlertDialogDrawerBody>}
      <AlertDialogDrawerFooter>
        <AlertDialogDrawerCancel>Cancel</AlertDialogDrawerCancel>
        <AlertDialogDrawerAction onClick={onConfirm}>{busy && <LoaderCircle  />}{switching ? busy ? "Switching…" : "Switch account" : busy ? "Signing out…" : "Sign out"}</AlertDialogDrawerAction>
      </AlertDialogDrawerFooter>
    </AlertDialogDrawerContent>
  </AlertDialogDrawer>;
}
