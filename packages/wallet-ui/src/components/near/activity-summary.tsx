"use client";
import type { ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight } from "@dya/ui/icons";
import { ActivityDetail } from "@dya/ui/components/activity-detail";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { AssetMark } from "./asset-mark";
import { useCatalogQuery } from "../../hooks/use-wallet-queries";
import { D } from "../../lib/near/domain/decimal";
import type { CatalogAsset } from "../../lib/near/domain/catalog";

export function ActivitySummary({ title, direction, symbol, assetId, asset: suppliedAsset, amount, subtitle, usdValue, children, note }: {
  title: string; direction: "in" | "out"; symbol: string; assetId?: string; asset?: CatalogAsset;
  amount?: string | null; subtitle?: ReactNode; usdValue?: string; children: ReactNode; note?: ReactNode;
}) {
  const catalog = useCatalogQuery();
  const asset = catalog.data?.assets.find(item => item.assetId === (assetId ?? suppliedAsset?.assetId)) ?? suppliedAsset;
  const usd = usdValue ?? (asset?.price && amount != null && new D(asset.price).gt(0) ? new D(amount).mul(asset.price).toFixed() : undefined);
  const Icon = direction === "in" ? ArrowDownLeft : ArrowUpRight;
  const tone = direction === "in" ? "bg-primary" : "bg-market-down";
  return <ActivityDetail title={title} subtitle={subtitle}
    icon={<span className="relative shrink-0">{asset ? <AssetMark asset={asset} size={36} /> : <span className={`flex size-9 items-center justify-center rounded-full ${tone}`}><Icon className="size-5 text-popover" /></span>}<span className={`absolute -bottom-1 -right-1 rounded-full border p-0.5 ${tone}`}><Icon className="size-3 text-popover" /></span></span>}
    amount={<FormattedNumber value={amount} symbol={symbol} exactTooltip />}
    note={note}
    valuation={usd !== undefined ? <span title={usdValue === undefined ? "Value at the current token price" : "Value at the reported trade price"}><FormattedNumber value={usd} format="currency" /></span> : undefined}>
    {children}
  </ActivityDetail>;
}
