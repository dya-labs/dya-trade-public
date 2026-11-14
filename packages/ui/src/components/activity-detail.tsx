"use client";
import type { ComponentProps, ReactNode } from "react";
import { DialogDrawerContent, DialogDrawerHeader, DialogDrawerTitle } from "@dya/ui/components/dialog-drawer";

export function ActivityDetailContent({ className, ...props }: ComponentProps<typeof DialogDrawerContent>) {
  return <DialogDrawerContent {...props} className={`max-h-[calc(100dvh-2rem)] overflow-y-auto ${className ?? ""}`} />;
}

export function ActivityDetail({ title, icon, subtitle, amount, valuation, children, note }: {
  title: string; icon: ReactNode; subtitle?: ReactNode; amount: ReactNode; valuation?: ReactNode; children: ReactNode; note?: ReactNode;
}) {
  return <>
    <DialogDrawerHeader><DialogDrawerTitle>{title}</DialogDrawerTitle></DialogDrawerHeader>
    <div className="space-y-2 text-center">
      <div className="flex justify-center pb-1">{icon}</div>
      <div className="min-w-0 break-words text-3xl font-medium tracking-tight">{amount}</div>
      {valuation && <div className="text-sm text-muted-foreground">{valuation}</div>}
    </div>
    <div className="space-y-3 border-t pt-3 text-sm">
      {subtitle && <ActivityDetailRow label="Time">{subtitle}</ActivityDetailRow>}
      {children}
    </div>
    {note && <p role="note" className="text-xs text-muted-foreground">{note}</p>}
  </>;
}
export function ActivityDetailRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-start justify-between gap-4"><span className="shrink-0 text-muted-foreground">{label}</span><div className="min-w-0 text-right">{children}</div></div>;
}
