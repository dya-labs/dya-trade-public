import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { Button } from "@dya/ui/components/button";
import { CircleAlert } from "@dya/ui/icons";

export function PortfolioDataWarning({ unavailable, retry, scope = "Balances", className }: {
  unavailable: boolean; retry: () => void; scope?: "Balances" | "Portfolio"; className?: string;
}) {
  if (unavailable) return <Alert className={className}><CircleAlert /><AlertDescription className="flex items-center justify-between gap-3"><span>{scope === "Portfolio" ? "Portfolio data is unavailable." : "Balances unavailable."}</span><Button size="xs" variant="ghost" className="shrink-0" onClick={retry}>Retry</Button></AlertDescription></Alert>;
  return <div role="status" className={`flex min-w-0 items-center gap-2 text-sm text-muted-foreground ${className ?? ""}`}>
    <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
    <span className="min-w-0 flex-1">Updates delayed · Showing last known balances</span>
    <Button size="xs" variant="ghost" className="shrink-0" onClick={retry}>Retry</Button>
  </div>;
}
