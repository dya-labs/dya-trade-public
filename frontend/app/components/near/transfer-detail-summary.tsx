"use client";
import type { ReactNode } from "react";
import { ActivitySummary } from "@dya/wallet-ui/components/near/activity-summary";

export function TransferDetailSummary({ direction, status, ...props }: {
  direction: "deposit" | "withdrawal"; status: string; symbol: string; assetId?: string; amount?: string; subtitle?: ReactNode; children: ReactNode;
}) {
  return <ActivitySummary {...props} direction={direction === "deposit" ? "in" : "out"}
    title={status === "Completed" ? direction === "deposit" ? "Deposited" : "Withdrew" : `${direction === "deposit" ? "Deposit" : "Withdrawal"} · ${status}`} />;
}
