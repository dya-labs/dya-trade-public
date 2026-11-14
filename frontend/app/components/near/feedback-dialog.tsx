import { useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@dya/ui/components/button";
import { DialogDrawer, DialogDrawerContent, DialogDrawerHeader, DialogDrawerTitle, DialogDrawerDescription, DialogDrawerFooter } from "@dya/ui/components/dialog-drawer";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@dya/ui/components/input-group";
import { LoaderCircle, MessageSquareFilled } from "@dya/ui/icons";
import { request } from "@dya/wallet-ui/lib/near/http/request";

export function FeedbackDialog({ accountId }: { accountId: string | null }) {
  const [open, setOpen] = useState(false), [message, setMessage] = useState("");
  const [pending, setPending] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState("");
  const submission = useRef<string | null>(null);
  const busy = useRef(false);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || !accountId || message.trim().length < 3) return;
    busy.current = true; setPending(true); setError("");
    submission.current ??= crypto.randomUUID();
    try {
      await request("feedback", z.object({ ok: z.literal(true) }), { id: submission.current, message: message.trim() });
      setSent(true); setMessage(""); submission.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to send feedback. Please try again."); }
    finally { busy.current = false; setPending(false); }
  }
  return <>
    <Button variant="ghost" size="xs" className="pl-[7px] text-muted-foreground" onClick={() => { setOpen(true); setSent(false); setError(""); }}><MessageSquareFilled aria-hidden="true" />Send feedback</Button>
    <DialogDrawer open={open} onOpenChange={value => { if (!busy.current) setOpen(value); }}>
      <DialogDrawerContent className="sm:max-w-md">
        <DialogDrawerHeader><DialogDrawerTitle>{sent ? "Feedback sent" : "Send feedback"}</DialogDrawerTitle><DialogDrawerDescription className="sr-only">Share feedback with the DYA team.</DialogDrawerDescription></DialogDrawerHeader>
        {sent ? <><p className="text-sm text-muted-foreground">Thanks for helping improve DYA.</p><DialogDrawerFooter><Button className="w-full" onClick={() => setOpen(false)}>Done</Button></DialogDrawerFooter></> :
          <form onSubmit={event => void send(event)} className="space-y-4">
            <InputGroup><InputGroupAddon align="block-start"><label htmlFor="terminal-feedback">Feedback</label></InputGroupAddon><InputGroupTextarea id="terminal-feedback" placeholder="What could we improve?" value={message} maxLength={2000} minLength={3} required disabled={pending || !accountId} aria-invalid={!!error} aria-describedby={error ? "feedback-error" : undefined} onChange={event => { setMessage(event.target.value); setError(""); submission.current = null; }} /></InputGroup>
            {!accountId && <p className="text-sm text-muted-foreground">Sign in to send feedback.</p>}
            {error && <p id="feedback-error" role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogDrawerFooter><Button type="submit" className="w-full" disabled={pending || !accountId || message.trim().length < 3}>{pending && <LoaderCircle className="animate-spin" />}{pending ? "Sending…" : "Send feedback"}</Button></DialogDrawerFooter>
          </form>}
      </DialogDrawerContent>
    </DialogDrawer>
  </>;
}
