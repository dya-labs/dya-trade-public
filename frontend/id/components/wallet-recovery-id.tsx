"use client";
import { useHapticFeedback } from "@dya/ui/hooks/use-haptic-feedback";
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "@dya/ui/icons";
import { Button } from "@dya/ui/components/button";
import { Input } from "@dya/ui/components/input";
import { Label } from "@dya/ui/components/label";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
export function RecoveryId({ value }: { value: string }) {
  const feedback = useHapticFeedback();
  const [confirmation, setConfirmation] = useState<{ value: string } | null>(null);
  const [error, setError] = useState<{ value: string; message: string } | null>(null);
  const attempt = useRef(0), queue = useRef<Promise<void>>(Promise.resolve());
  const copied = confirmation?.value === value;
  useEffect(() => { if (!confirmation) return;const timer = setTimeout(() => setConfirmation(null), 2000);return () => clearTimeout(timer); }, [confirmation]);
  async function copy() {
    const current = ++attempt.current;
    const pending = queue.current.catch(() => {}).then(() => navigator.clipboard.writeText(value));queue.current = pending;
    try { await pending;if (current !== attempt.current) return;feedback("light");setConfirmation({ value });setError(null); }
    catch { if (current !== attempt.current) return;setConfirmation(null);setError({ value, message: "Unable to copy recovery ID. Select and copy it manually." }); }
  }
  return <div className="space-y-2"><Label htmlFor="saved-recovery-id">Recovery ID</Label><Input id="saved-recovery-id" readOnly value={value} /><Button variant="outline" size="sm" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy recovery ID"}</Button>{error?.value === value && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}</div>;
}
