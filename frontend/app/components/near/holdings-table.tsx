import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@dya/ui/components/table";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { TableSkeletonRows } from "@dya/ui/components/table-skeleton";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { D } from "@/lib/near/domain/decimal";
import { AssetMark } from "./asset-mark";
import type { portfolioHoldings } from "./portfolio-model";

export function HoldingsTable({ model, waiting, partial, label = "Portfolio holdings", compact = false }: { model: ReturnType<typeof portfolioHoldings>; waiting: boolean; partial: boolean; label?: string; compact?: boolean }) {
  return <Table columnWidths={compact ? [160,144,144,144,144] : [160,144,144,144,144,144,104]} loading={waiting} loadingLabel={compact ? "Loading balances" : "Loading holdings"} aria-label={label}>
    <TableHeader><TableRow>
      <TableHead>Asset</TableHead>
      <TableHead className="text-right">Available</TableHead>
      <TableHead className="text-right">In orders</TableHead>
      <TableHead className="text-right">Total</TableHead>
      {!compact && <TableHead className="text-right">Price (USD)</TableHead>}
      <TableHead className="text-right">USD value</TableHead>
      {!compact && <TableHead className="text-right">Allocation</TableHead>}
    </TableRow></TableHeader>
    <TableBody>
      {waiting && !model.rows.length && <TableSkeletonRows columns={compact ? 5 : 7} />}
      {model.rows.map(row => <TableRow key={row.asset.assetId}>
        <TableCell><span className="flex items-center gap-2"><AssetMark asset={row.asset} />{displaySymbol(row.asset)}</span></TableCell>
        <TableCell className="text-right"><FormattedNumber value={row.available} unit={displaySymbol(row.asset)} exactTooltip /></TableCell>
        <TableCell className="text-right"><FormattedNumber value={row.committed} unit={displaySymbol(row.asset)} exactTooltip /></TableCell>
        <TableCell className="text-right"><FormattedNumber value={row.amount} unit={displaySymbol(row.asset)} exactTooltip /></TableCell>
        {!compact && <TableCell className="text-right"><FormattedNumber value={row.price} format="price" /></TableCell>}
        <TableCell className="text-right"><FormattedNumber value={row.value} format="currency" /></TableCell>
        {!compact && <TableCell className="text-right">{!partial && row.value !== null && new D(model.totalValue).gt(0) ? <FormattedNumber value={new D(row.value).div(model.totalValue).toFixed()} intl={{ style: "percent", maximumFractionDigits: 1 }} /> : "—"}</TableCell>}
      </TableRow>)}
    </TableBody>
  </Table>;
}
