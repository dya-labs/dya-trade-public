import type { ReactNode } from "react";
import { FormattedNumber } from "@dya/ui/components/formatted-number";

export function SendReview({ label, amount, symbol, icon, estimated, recipient, children }: {
  label: string;
  amount: string;
  symbol: string;
  icon?: ReactNode;
  estimated?: boolean;
  recipient: ReactNode;
  children: ReactNode;
}) {
  return <>
    <div className="flex flex-col items-center gap-2 py-3">
      <p className="text-muted-foreground">{label}</p>
      <div className="flex items-center gap-3">
        {icon}
        <p className="text-3xl font-semibold" title={amount}><FormattedNumber value={amount} symbol={symbol} /></p>
      </div>
      {estimated && <p className="text-xs text-muted-foreground">Estimated</p>}
    </div>
    {recipient}
    {children}
  </>;
}
