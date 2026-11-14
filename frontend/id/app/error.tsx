"use client";
import { ReportedErrorFallback } from "@dya/ui/components/app-error-boundary";

/** Route segment crashes: report and show the shared recovery screen inside the root layout. */
export default function RouteError({ error }: { error: Error & { digest?: string } }) {
  return <ReportedErrorFallback error={error} />;
}
