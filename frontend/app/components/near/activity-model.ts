import type { StoredOrder, Trade } from "@/lib/near/http/schemas/trading";
import { DEFAULT_PAIR, type SelectedPair } from "@/lib/near/domain/catalog";
import { D } from "@/lib/near/domain/decimal";

export function pendingMarket(trade: Trade, selected?: SelectedPair): boolean {
  return !["settled", "failed"].includes(trade.state) && inMarket(trade.review.pair, selected);
}

export function submittedLimit(order: StoredOrder): boolean {
  return !!order.fundingState || order.state === "unknown" || !!(order.provider && (order.provider.depositedAmount !== "0" || order.provider.partialFills.length || ["OPEN", "PARTIALLY_FILLED", "FILLED"].includes(order.provider.fillStatus)));
}
export function actionableLimit(order: StoredOrder): boolean {
  if (!submittedLimit(order)) return false;
  if (order.syncError || order.cancelPending || order.state === "unknown" || order.provider?.payoutStatus === "FAILED") return true;
  return !(order.provider?.payoutFinal && ["FILLED", "CANCELED", "EXPIRED"].includes(order.provider.fillStatus));
}
export function inMarket(pair: SelectedPair | undefined, selected?: SelectedPair): boolean {
  const actual = pair ?? DEFAULT_PAIR;
  return !selected || (actual.base.assetId === selected.base.assetId && actual.quote.assetId === selected.quote.assetId);
}
export function limitSizes(order: StoredOrder): { filled: string | null; remaining: string | null } {
  try {
    const fills = order.provider?.partialFills;
    if (!fills || (!fills.length && ["FILLED", "PARTIALLY_FILLED"].includes(order.provider!.fillStatus))) return { filled: null, remaining: null };
    if (new Set(fills.map(fill => fill.id)).size !== fills.length) return { filled: null, remaining: null };
    const raw = fills.reduce((total, fill) => total.add(order.preview.side === "buy" ? fill.amountOut : fill.amountIn), new D(0));
    const total = new D(order.preview.request.data.attributes.quantity);
    if (raw.lt(0) || raw.gt(total)) return { filled: null, remaining: null };
    const scale = new D(10).pow((order.preview.pair ?? DEFAULT_PAIR).base.decimals);
    return { filled: raw.div(scale).toFixed(), remaining: total.minus(raw).div(scale).toFixed() };
  } catch { return { filled: null, remaining: null }; }
}
export type ExecutionRow = {
  id: string; pair: SelectedPair; side: "buy" | "sell"; type: "Market" | "Limit";
  input: string | null; output: string | null; size: string | null; price: string | null;
  time: number; timeIsUpdate: boolean; source: StoredOrder | Trade; unavailable: boolean;
};
export function executionRows(orders: StoredOrder[], trades: Trade[], selected?: SelectedPair): ExecutionRow[] {
  const rows: ExecutionRow[] = [];
  for (const trade of trades) {
    if (trade.state !== "settled" || !inMarket(trade.review.pair, selected)) continue;
    const e = trade.execution, buy = trade.review.side === "buy", pair = trade.review.pair ?? DEFAULT_PAIR;
    const size = e ? buy ? e.outputAmount : e.inputAmount : null;
    const quote = e ? buy ? e.inputAmount : e.outputAmount : null;
    rows.push({ id: `market:${trade.id}`, type: "Market", pair, side: trade.review.side, input: e?.inputAmount ?? null, output: e?.outputAmount ?? null,
      size, price: size && quote && new D(size).gt(0) ? new D(quote).div(size).toFixed() : null,
      time: e?.settledAt ?? trade.updatedAt, timeIsUpdate: !e, source: trade, unavailable: !e });
  }
  for (const order of orders) {
    if (!inMarket(order.preview.pair, selected)) continue;
    if (order.provider?.partialFills.length && limitSizes(order).filled === null) continue;
    const pair = order.preview.pair ?? DEFAULT_PAIR, buy = order.preview.side === "buy";
    if (!order.provider?.partialFills.length && ["FILLED", "PARTIALLY_FILLED"].includes(order.provider?.fillStatus ?? "")) {
      rows.push({ id: `limit:${order.id}:unavailable`, type: "Limit", pair, side: order.preview.side, input: null, output: null, size: null, price: null,
        time: order.updatedAt, timeIsUpdate: true, source: order, unavailable: true });
    }
    for (const fill of order.provider?.partialFills ?? []) {
      const input = new D(fill.amountIn).div(new D(10).pow((buy ? pair.quote : pair.base).decimals)).toFixed();
      const output = new D(fill.amountOut).div(new D(10).pow((buy ? pair.base : pair.quote).decimals)).toFixed();
      const size = buy ? output : input, quote = buy ? input : output;
      rows.push({ id: `limit:${order.id}:${fill.id}`, type: "Limit", pair, side: order.preview.side, input, output, size,
        price: new D(size).gt(0) ? new D(quote).div(size).toFixed() : null,
        time: fill.createdAt ?? order.updatedAt, timeIsUpdate: fill.createdAt === undefined, source: order, unavailable: false });
    }
  }
  return rows.sort((a, b) => b.time - a.time);
}
