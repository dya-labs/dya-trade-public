import { usePortfolio, type TradingWalletData } from "./use-portfolio";
import type { ReactNode } from "react";
import { Button } from "@dya/ui/components/button";
import { Card, CardHeader, CardTitle, CardContent } from "@dya/ui/components/card";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { Tooltip, TooltipTrigger, TooltipContent } from "@dya/ui/components/tooltip";
import { MeasuredSkeleton } from "@dya/ui/components/skeleton";
import { PortfolioDataWarning } from "./portfolio-data-warning";
import { Info, ArrowDownLeft, ArrowUpRight } from "@dya/ui/icons";
import { ConfidentialAccess } from "./confidential-access";

export function Portfolio({ accountId, loading, busy, connect, deposit, withdraw, activity, trading }: {
  accountId: string | null; loading: boolean; busy: boolean; connect: () => void; deposit: () => void; withdraw: () => void; activity: ReactNode; trading?: TradingWalletData;
}) {
  const { locked, waiting, failed, pricesDelayed, model, partial, noValuation, unavailable, retry } = usePortfolio(accountId, loading, trading);
  return <div key={accountId} className="min-h-[calc(100vh-5.75rem)] bg-background px-4 py-6 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>{accountId && <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={withdraw}><ArrowUpRight />Withdraw</Button><Button disabled={busy} onClick={deposit}><ArrowDownLeft />Deposit</Button></div>}</div>
      {!loading && !accountId ? <Card><CardContent className="flex flex-col items-center gap-4 py-12 text-center"><h2 className="font-medium">Your portfolio, in one place</h2><p className="text-sm text-muted-foreground">Connect your wallet to view balances, orders, and activity.</p><Button disabled={busy} onClick={connect}>Connect wallet</Button></CardContent></Card> : locked ? <Card><CardContent className="py-6"><ConfidentialAccess panel /></CardContent></Card> : <>
        {failed && <PortfolioDataWarning unavailable={unavailable} retry={retry} scope="Portfolio" />}
        <div className="grid gap-3 sm:grid-cols-3">{[{ label: "Portfolio value", value: model.totalValue }, { label: "In wallet", value: model.availableValue }, { label: "In open orders", value: model.committedValue }].map(item => <Card key={item.label}><CardHeader><CardTitle className="flex items-center gap-1 text-sm font-normal text-muted-foreground">{item.label}{item.label === "Portfolio value" && <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="About portfolio value" />}><Info className="size-3.5" /></TooltipTrigger><TooltipContent>Wallet balances and confirmed funds remaining in open orders. Pending deposits, withdrawals, and settlement are excluded.</TooltipContent></Tooltip>}</CardTitle></CardHeader><CardContent><MeasuredSkeleton loading={waiting} label={`Loading ${item.label.toLowerCase()}`}><span className="text-3xl font-semibold">{!waiting && (unavailable || noValuation) ? "—" : <FormattedNumber value={waiting ? "1000" : item.value} format="currency" />}</span></MeasuredSkeleton>{!waiting && partial && <p className="mt-1 text-xs text-muted-foreground">Partial valuation</p>}</CardContent></Card>)}</div>
        {!waiting && (pricesDelayed || model.unsettled > 0) && <p role="status" className="text-xs text-muted-foreground">{pricesDelayed && "Market prices are delayed."}{pricesDelayed && model.unsettled > 0 && " "}{model.unsettled > 0 && "Some funds are awaiting settlement and are not included in portfolio value."}</p>}
      </>}
      {accountId && activity}
    </div>
  </div>;
}
