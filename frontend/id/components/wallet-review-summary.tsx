import type { ReactNode } from "react";

export function WalletReviewSummary({ label, children }: { label: string; children: ReactNode }) {
  return <div>
    <p className="text-sm text-muted-foreground">{label}</p>
    <div className="break-words text-xl font-medium">{children}</div>
  </div>;
}

export function WalletReviewRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <div className="flex justify-between gap-4">
    <dt className="shrink-0 text-muted-foreground">{label}</dt>
    <dd className="break-all text-right">{children}</dd>
  </div>;
}
