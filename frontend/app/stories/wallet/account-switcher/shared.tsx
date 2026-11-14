import { Badge } from "@dya/ui/components/badge";
import { AccountAvatar } from "@dya/ui/components/account-avatar";
export function BorderedAvatar({ seed = "personal", small = false, interactive = false, compact = false }: { seed?: string; small?: boolean; interactive?: boolean; compact?: boolean }) {
  return <span className={`flex shrink-0 items-center justify-center rounded-full border border-control-border bg-control ${compact ? "size-7 p-px" : small ? "size-8 p-1" : "size-10 p-1"} ${interactive ? "transition-colors group-hover:border-foreground/30 group-data-open:border-foreground/30" : ""}`}><AccountAvatar seed={seed} size="sm" /></span>;
}

export function TradingMark() {
  return <Badge variant="secondary" className="size-4 shrink-0 justify-center rounded-sm bg-primary/15 p-0 text-primary" title="Trading account"><svg viewBox="0 0 12 12" className="size-2.5" fill="currentColor" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z" /></svg><span className="sr-only">Trading account</span></Badge>;
}
