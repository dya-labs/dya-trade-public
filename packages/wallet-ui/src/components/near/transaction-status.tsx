import type { ReactNode } from "react";

/** Shared layout for deposit, withdrawal, and funding outcomes. */
export function TransactionStatus({ children }: { children: ReactNode }) {
  return <section className="flex min-h-72 flex-col gap-4">{children}</section>;
}

export function TransactionStatusBody({ children }: { children: ReactNode }) {
  return <div role="status" aria-live="polite" aria-atomic="true" className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center">{children}</div>;
}
