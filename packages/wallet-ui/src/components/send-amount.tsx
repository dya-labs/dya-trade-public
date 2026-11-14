"use client";

import { D } from "@dya/wallet-contracts/src/domain/decimal";
import { Button } from "@dya/ui/components/button";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { Input } from "@dya/ui/components/input";
import { Label } from "@dya/ui/components/label";

export function SendAmount({ id, symbol, balance, amount, onChange, busy, loading, unavailable, insufficient }: {
  id: string;
  symbol?: string;
  balance?: { amount: string; decimals: number };
  amount: string;
  onChange: (amount: string) => void;
  busy?: boolean;
  loading?: boolean;
  unavailable?: boolean;
  insufficient?: boolean;
}) {
  return <div className="space-y-3">
    <Label className="sr-only" htmlFor={id}>{symbol ? `Amount (${symbol})` : "Amount"}</Label>
    <Input id={id} aria-invalid={insufficient} inputMode="decimal" autoComplete="off" placeholder="0"
      className={`h-20 border-0 bg-transparent text-center text-5xl shadow-none focus-visible:ring-0 dark:bg-transparent md:text-5xl${insufficient ? " text-destructive" : ""}`}
      value={amount} disabled={busy} onChange={event => onChange(event.target.value)} />
    <p className="text-center text-muted-foreground">Available: {balance ? <FormattedNumber value={balance.amount} symbol={symbol} /> : loading ? "Loading…" : "-"}</p>
    <div className="grid grid-cols-4 gap-2">
      {[25, 50, 75, 100].map(percent => <Button key={percent} type="button" variant="outline"
        disabled={busy || !balance || unavailable} onClick={() => {
          if (balance) onChange(percent === 100 ? balance.amount : new D(balance.amount).mul(percent).div(100).toDecimalPlaces(balance.decimals, D.ROUND_DOWN).toFixed());
        }}>{percent === 100 ? "Max" : `${percent}%`}</Button>)}
    </div>
  </div>;
}
