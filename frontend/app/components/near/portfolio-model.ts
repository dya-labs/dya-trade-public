import type { CatalogAsset } from "@/lib/near/domain/catalog";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import type { StoredOrder } from "@/lib/near/http/schemas/trading";
import { D } from "@/lib/near/domain/decimal";
export type PortfolioBalance = { assetId: string; symbol: string; decimals: number; amount: string; raw: string };
export function portfolioHoldings(balances: PortfolioBalance[], orders: StoredOrder[], catalog: CatalogAsset[], prices: Record<string, { price: number | null }>) {
  const rows = new Map<string, { asset: CatalogAsset; available: string; committed: string; amount: string; price: number | null; value: string | null }>();
  const rowFor = (asset: CatalogAsset) => {
    let row = rows.get(asset.assetId);
    if (!row) { row = { asset, available: "0", committed: "0", amount: "0", price: null, value: null }; rows.set(asset.assetId, row); }
    return row;
  };
  for (const balance of balances) if (new D(balance.amount).gt(0)) {
    const row = rowFor(catalog.find(asset => asset.assetId === balance.assetId) ?? { ...balance, blockchain: "unknown" });
    row.available = new D(row.available).add(balance.amount).toFixed();
  }
  let unsettled = 0;
  for (const order of orders) {
    const provider = order.provider;
    if (order.state !== "created" || order.syncError || order.cancelPending || !provider || provider.payoutStatus === "FAILED") {
      if (order.fundingState && !(provider?.payoutFinal)) unsettled++;
      continue;
    }
    if (!["OPEN", "PARTIALLY_FILLED"].includes(provider.fillStatus)) {
      if (!provider.payoutFinal && new D(provider.depositedAmount).gt(0)) unsettled++;
      continue;
    }
    const pair = order.preview.pair ?? DEFAULT_PAIR, asset = order.preview.side === "buy" ? pair.quote : pair.base;
    // Provider deposits are escrowed outside the confidential wallet balance. Subtract
    // actual consumed input, never infer escrow from the original order's notional size.
    if (provider.inputAsset !== asset.assetId || new Set(provider.partialFills.map(fill => fill.id)).size !== provider.partialFills.length || (provider.fillStatus === "PARTIALLY_FILLED" && !provider.partialFills.length)) { unsettled++; continue; }
    const remaining = new D(provider.depositedAmount).minus(provider.partialFills.reduce((sum, fill) => sum.add(fill.amountIn), new D(0)));
    if (remaining.lt(0)) { unsettled++; continue; }
    if (remaining.gt(0)) {
      const row = rowFor(catalog.find(item => item.assetId === asset.assetId) ?? asset);
      row.committed = new D(row.committed).add(remaining.div(new D(10).pow(asset.decimals))).toFixed();
    }
  }
  let availableValue = new D(0), committedValue = new D(0), unpriced = 0;
  for (const row of rows.values()) {
    row.amount = new D(row.available).add(row.committed).toFixed();
    const price = prices[row.asset.assetId]?.price;
    if (price != null && Number.isFinite(price) && price > 0) {
      row.price = price;
      row.value = new D(row.amount).mul(price).toFixed();
      availableValue = availableValue.add(new D(row.available).mul(price));
      committedValue = committedValue.add(new D(row.committed).mul(price));
    } else unpriced++;
  }
  return { rows: [...rows.values()].sort((a, b) => new D(b.value ?? 0).cmp(a.value ?? 0)), availableValue: availableValue.toFixed(), committedValue: committedValue.toFixed(), totalValue: availableValue.add(committedValue).toFixed(), unpriced, unsettled };
}
