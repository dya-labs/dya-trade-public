"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { DialogDrawer, DialogDrawerContent, DialogDrawerHeader, DialogDrawerTitle, DialogDrawerDescription } from "@dya/ui/components/dialog-drawer";
import { Card, CardContent } from "@dya/ui/components/card";
import { CenteredHeading } from "@dya/ui/components/centered-heading";
import { Button } from "@dya/ui/components/button";
import { ArrowLeft, Globe, X } from "@dya/ui/icons";

/** ID owns the visible wallet frame in embedded and standalone presentations. */
export function WalletFrame({ embedded, requester, title, icon, headingLayout = "centered", busy, onCancel, onBack, children }: { embedded: boolean; requester: string; title: string; icon?: ReactNode; headingLayout?: "centered" | "compact"; busy: boolean; onCancel: () => void; onBack?: () => void; children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || embedded || !window.opener || !surface.current || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      timer = setTimeout(() => { window.resizeTo(window.outerWidth, Math.ceil(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height) + 24 + window.outerHeight - window.innerHeight); }, 100);
    });
    observer.observe(surface.current);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [embedded]);
  const header = <div className="flex min-h-9 min-w-0 items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">{onBack && <Button variant="ghost" size="icon-sm" aria-label="Back" disabled={busy} onClick={onBack}><ArrowLeft /></Button>}<Globe className="size-4 shrink-0" /><span className="truncate" title={requester}>{requester}</span></div><Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Close wallet" disabled={busy} onClick={onCancel}><X /></Button></div>;
  const screen = <div className="min-w-0 space-y-4">{headingLayout === "compact"
    ? <div className="flex items-center gap-2">{icon}<h1 className="text-lg font-medium">{title}</h1></div>
    : <CenteredHeading as="h1" icon={icon} title={title} /> }{children}</div>;
  if (embedded) return <DialogDrawer open dismissible={!busy} onOpenChange={open => { if (!open && !busy) onCancel(); }}><DialogDrawerContent showCloseButton={false} className="max-h-[calc(100dvh-1rem)] overflow-y-auto"><DialogDrawerHeader className="min-h-0 px-3 py-1">{header}<DialogDrawerTitle className="sr-only">{title}</DialogDrawerTitle><DialogDrawerDescription className="sr-only">Wallet request from {requester}</DialogDrawerDescription></DialogDrawerHeader>{screen}</DialogDrawerContent></DialogDrawer>;
  return <main className="mx-auto flex min-h-dvh max-w-sm items-center p-3"><Card ref={surface} className="w-full gap-4 rounded-[var(--radius-dialog)] pt-0"><div className="border-b border-border px-3 py-1">{header}</div><CardContent className="px-3">{screen}</CardContent></Card></main>;
}
