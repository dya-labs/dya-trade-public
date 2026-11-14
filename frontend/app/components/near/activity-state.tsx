import type { ReactNode } from "react";
import { Button } from "@dya/ui/components/button";
import { RelativeTime } from "@dya/ui/components/relative-time";
import { Clock, WifiOff } from "@dya/ui/icons";
import { cn } from "@dya/ui/lib/utils";
import { WalletSectionEmpty } from "@dya/wallet-ui/components/wallet-section";

export function ActivityEmpty({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return <div className={cn("p-3", className)}><WalletSectionEmpty className="flex-col gap-3 px-3 py-6"><span>{children}</span>{action}</WalletSectionEmpty></div>;
}

export function ActivityRecovery({ children, onRetry, retrying = false }: { children: ReactNode; onRetry?: () => void; retrying?: boolean }) {
  return <div className="flex min-h-36 flex-col items-center justify-center gap-3 px-4 py-6 text-center">
    <WifiOff aria-hidden="true" className="size-5 text-muted-foreground" />
    <p role="status" className="text-sm text-muted-foreground">{children}</p>
    {onRetry && <Button variant="ghost" size="xs" disabled={retrying} onClick={onRetry}>{retrying ? "Retrying…" : "Retry"}</Button>}
  </div>;
}

export function oldestUpdate(...timestamps: number[]) {
  const known = timestamps.filter(time => Number.isFinite(time) && time > 0);
  return known.length ? Math.min(...known) : undefined;
}

export function ActivityRefreshStatus({ lastUpdatedAt, onRetry, retrying, children = "Updates delayed", className }: { lastUpdatedAt?: number; onRetry: () => void; retrying: boolean; children?: ReactNode; className?: string }) {
  return <div role="status" className={cn("flex items-center justify-between gap-3 pb-2 text-xs text-muted-foreground", className)}>
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"><Clock aria-hidden="true" className="size-3 shrink-0" />{lastUpdatedAt !== undefined && <><span>Last updated <RelativeTime timestamp={lastUpdatedAt} /></span><span aria-hidden="true">·</span></>}<span>{children}</span></span>
    <Button variant="ghost" size="xs" disabled={retrying} onClick={onRetry}>{retrying ? "Retrying…" : "Retry"}</Button>
  </div>;
}
