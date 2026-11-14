import { Alert, AlertDescription, AlertTitle } from "@dya/ui/components/alert";
import { TriangleAlert } from "@dya/ui/icons";
import type { DataDegraded } from "@/lib/market-data/api";

/** Degraded when the data API reports an upstream outage or the Terminal's own 1Click catalog request failed. */
export function serviceDegraded(reported: DataDegraded | null | undefined, catalogFailed: boolean) {
  return !!reported || catalogFailed;
}

/** Persistent while degraded; clears itself on recovery, so it is not dismissable. */
export function ServiceDegradedBanner({ className }: { className?: string }) {
  return <Alert variant="warning" role="status" className={className}>
    <TriangleAlert aria-hidden="true" />
    <AlertTitle>Service degraded</AlertTitle>
    <AlertDescription>NEAR chain infrastructure (NEAR Intents 1Click) is having issues. Charts and prices stay available; trading is paused until it recovers.</AlertDescription>
  </Alert>;
}
