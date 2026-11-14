"use client";
import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "@dya/ui/icons";
import { Button } from "@dya/ui/components/button";

/** Full-page recovery screen after a crash. */
export function AppErrorFallback() {
  return <main role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
    <TriangleAlert className="size-8 text-muted-foreground" aria-hidden="true" />
    <h1 className="text-base font-medium">Something went wrong</h1>
    <p className="text-sm text-muted-foreground">Reload the page to continue.</p>
    <Button variant="outline" onClick={() => window.location.reload()}>Reload</Button>
  </main>;
}

/** Logs `error` to the console once and shows the recovery screen; for framework error pages (DYA ID's error.tsx). */
export function ReportedErrorFallback({ error }: { error: unknown }) {
  useEffect(() => console.error(error), [error]);
  return <AppErrorFallback />;
}

/** Catches render errors anywhere below it, logs them and shows the recovery screen instead of a blank page. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  override render() { return this.state.failed ? <AppErrorFallback /> : this.props.children; }
}
