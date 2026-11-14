import { ActivityEmpty, ActivityRecovery, ActivityRefreshStatus } from "./activity-state";
import { ConfidentialAccess } from "./confidential-access";
import { HoldingsTable } from "./holdings-table";
import { usePortfolio, type TradingWalletData } from "./use-portfolio";

export function Balances({ accountId, showDataWarning = true, trading }: { accountId: string | null; showDataWarning?: boolean; trading?: TradingWalletData }) {
  const { locked, waiting, failed, pricesDelayed, model, partial, unavailable, retry, lastUpdatedAt, refreshing } = usePortfolio(accountId, false, trading);
  if (!accountId) return <ActivityEmpty>Connect your wallet to view balances.</ActivityEmpty>;
  if (locked) return <div className="px-4"><ConfidentialAccess panel /></div>;
  if (!waiting && unavailable) return <section aria-label="Balances"><ActivityRecovery onRetry={showDataWarning ? retry : undefined} retrying={refreshing}>Couldn’t load balances</ActivityRecovery></section>;
  return <section aria-label="Balances" className="space-y-3 [&_table_tr>:first-child]:pl-4 [&_table_tr>:last-child]:pr-4">
    {!waiting && !model.rows.length ? <ActivityEmpty>No assets yet</ActivityEmpty> : <HoldingsTable model={model} waiting={waiting} partial={partial} label="Balances" compact />}
    {!waiting && showDataWarning && (failed || pricesDelayed) && <ActivityRefreshStatus className="px-4" lastUpdatedAt={lastUpdatedAt} onRetry={retry} retrying={refreshing}>{failed ? "Updates delayed" : "Market prices delayed"}</ActivityRefreshStatus>}
    {!waiting && partial && <p role="status" className="px-4 pb-2 text-xs text-muted-foreground">Partial valuation. {model.unsettled > 0 && model.unpriced > 0 ? "Funds awaiting settlement and unpriced assets are excluded from USD value." : model.unsettled > 0 ? "Funds awaiting settlement are excluded from USD value." : "Unpriced assets are excluded from USD value."}</p>}
  </section>;
}
