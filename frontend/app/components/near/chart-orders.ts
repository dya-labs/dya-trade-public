import type { StoredOrder } from "@/lib/near/http/schemas/trading";
import { DEFAULT_PAIR, type CatalogAsset, type SelectedPair } from "@/lib/near/domain/catalog";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { formatNumber } from "@dya/ui/lib/format-number";
import { D } from "@/lib/near/domain/decimal";
import { inMarket, limitSizes } from "./activity-model";

export type ChartOrderLine = { id: string; price: number; side: "buy" | "sell"; text: string };
/** Convert order quotes to the reference chart quote; never assume stablecoin parity. */
export function chartOrderLines(orders: StoredOrder[], pair: SelectedPair, chartQuote: string | undefined, assets: CatalogAsset[], now: number): ChartOrderLine[] {
  return chartLinesForPair(orders.flatMap(order => {
    if (!inMarket(order.preview.pair, pair) || order.state !== "created" || order.cancelPending || order.syncError || !order.provider || order.provider.payoutStatus === "FAILED" || !["OPEN", "PARTIALLY_FILLED"].includes(order.provider.fillStatus)) return [];
    const remaining = limitSizes(order).remaining;
    if (remaining === null || new D(remaining).lte(0)) return [];
    const market = order.preview.pair ?? DEFAULT_PAIR;
    return [{ id: order.id, price: Number(order.preview.price), side: order.preview.side, text: `${order.preview.side === "buy" ? "Buy" : "Sell"} limit · ${formatNumber(remaining)} ${displaySymbol(market.base)} · ${formatNumber(order.preview.price, { format: "price" })} ${displaySymbol(market.quote)}` }];
  }), pair, chartQuote, assets, now);
}

export function chartLinesForPair(lines: ChartOrderLine[], pair: SelectedPair, chartQuote: string | undefined, assets: CatalogAsset[], now: number): ChartOrderLine[] {
  if (!chartQuote) return [];
  const freshPrice = (asset: CatalogAsset | undefined) => {
    const time = Date.parse(asset?.priceUpdatedAt ?? ""), price = Number(asset?.price);
    return Number.isFinite(time) && time <= now + 60_000 && now - time < 600_000 && price > 0 && Number.isFinite(price) ? price : null;
  };
  let conversion = 1;
  if (chartQuote !== pair.quote.symbol) {
    const source = freshPrice(assets.find(asset => asset.assetId === pair.quote.assetId));
    const quoteCoin = ({ USDT: "tether", USDC: "usd-coin" } as Record<string, string>)[chartQuote];
    if (chartQuote !== "USD" && !quoteCoin) return [];
    const target = chartQuote === "USD" ? 1 : freshPrice(assets.find(asset => asset.symbol === chartQuote && asset.coingeckoId === quoteCoin));
    if (source === null || target === null) return [];
    conversion = source / target;
  }
  return lines.flatMap(line => {
    const price = line.price * conversion;
    return Number.isFinite(price) && price > 0 ? [{ ...line, price }] : [];
  });
}
