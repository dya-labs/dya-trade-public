import type { ReactNode } from "react";
import { ArrowDown } from "../icons";
import { FormattedNumber } from "./formatted-number";

type ReviewAmount = {
  amount: string | null;
  symbol: string;
  icon?: ReactNode;
  usd?: string | null;
  usdTitle?: string;
};

function AmountRow({ label, amount, symbol, icon, usd, usdTitle }: ReviewAmount & { label: string }) {
  return <div className="flex items-center justify-between gap-3">
    <div className="min-w-0 space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="break-all text-2xl font-semibold"><FormattedNumber value={amount} symbol={symbol} exactTooltip /></p>
      {usd != null && <p className="text-sm text-muted-foreground" title={usdTitle}><FormattedNumber value={usd} format="currency" /></p>}
    </div>
    {icon}
  </div>;
}

export function TradeReviewAmounts({ pay, receive, receiveLabel = "You receive" }: {
  pay: ReviewAmount;
  receive: ReviewAmount;
  receiveLabel?: string;
}) {
  return <div className="space-y-3">
    <AmountRow label="You pay" {...pay} />
    <ArrowDown className="size-4 text-muted-foreground" aria-hidden="true" />
    <AmountRow label={receiveLabel} {...receive} />
  </div>;
}
