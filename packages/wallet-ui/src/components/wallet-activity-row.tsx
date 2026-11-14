"use client";
import type { ReactNode } from "react";
import { MeasuredSkeleton } from "@dya/ui/components/skeleton";
import { Button } from "@dya/ui/components/button";
import { cn } from "@dya/ui/lib/utils";

/** Shared row layout for wallet activity and selection lists. */
export function WalletActivityRow({ icon, title, subtitle, amount, onClick, ariaLabel, className, disabled, loading = false }: { loading?: boolean;
  icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; amount?: ReactNode; disabled?: boolean;
  onClick?: () => void; ariaLabel?: string; className?: string;
}) {
  const value = (node: ReactNode) => loading ? <MeasuredSkeleton loading>{node}</MeasuredSkeleton> : node;
  const content = <>{value(icon)}<div className="min-w-0 flex-1"><div className="text-sm font-medium">{value(title)}</div>{subtitle != null && <div className="text-xs text-muted-foreground">{value(subtitle)}</div>}</div>{amount != null && <div className="shrink-0 text-right tabular-nums">{value(amount)}</div>}</>;
  const classes = cn("flex w-full min-w-0 flex-1 items-center gap-3 py-3 text-left", className);
  return onClick ? <Button type="button" disabled={disabled} variant="ghost" className={cn("h-auto justify-start rounded-none border-0 px-3 shadow-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-inset dark:hover:bg-hover active:translate-y-0", classes)} aria-label={ariaLabel} onClick={onClick}>{content}</Button> : <div className={classes} role={loading ? "status" : undefined} aria-label={loading ? "Loading activity" : ariaLabel} aria-busy={loading || undefined}>{content}</div>;
}
