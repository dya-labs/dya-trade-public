"use client";
import { MeasuredSkeleton } from "@dya/ui/components/skeleton";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { Button } from "@dya/ui/components/button";
import { ChevronDown } from "@dya/ui/icons";
import type { CatalogAsset, SelectedPair } from "@/lib/near/domain/catalog";
import { AssetSelector } from "./asset-selector";
import { TokenProjectLinks } from "./token-project-links";

export function MarketHeader({ pair, assets, awaitingAsset = false, statsLoading = false, capLoading = false,
  headerPrice, headerChange, headerChangeAmount, headerVolume, headerCap, mobile, marketStatsOpen, setMarketStatsOpen,
  tradingBusy, catalogUnavailable, retryCatalog, catalogRetrying, onSelect,
}: {
  pair: SelectedPair; assets: CatalogAsset[]; awaitingAsset?: boolean; statsLoading?: boolean; capLoading?: boolean;
  headerPrice?: number | null; headerChange?: number | null; headerChangeAmount?: number | null; headerVolume?: number | null; headerCap?: number | null;
  mobile: boolean; marketStatsOpen: boolean; setMarketStatsOpen: (value: boolean | ((open: boolean) => boolean)) => void;
  tradingBusy?: boolean; catalogUnavailable?: boolean; retryCatalog: () => void; catalogRetrying?: boolean; onSelect: (asset: CatalogAsset) => void;
}) {
  const priceChange = <div className="inline-flex items-center gap-1"><MeasuredSkeleton loading={statsLoading} label="Loading price change"><FormattedNumber value={statsLoading ? 0.12 : headerChangeAmount} intl={{ maximumSignificantDigits: 6, signDisplay: "exceptZero" }} /></MeasuredSkeleton><span className="text-muted-foreground">/</span><MeasuredSkeleton loading={statsLoading} label="Loading percentage change"><FormattedNumber value={statsLoading ? 0.03 : headerChange == null ? null : headerChange / 100} intl={{ style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" }} /></MeasuredSkeleton></div>;
  return <header key={pair.base.assetId} className="dia-panel grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 px-3 py-2.5 sm:flex sm:flex-wrap sm:gap-x-4 sm:px-4 sm:[&>div]:shrink-0">
    <div className="flex min-w-0 items-center gap-2 [&_button]:shrink" role={awaitingAsset ? "status" : undefined} aria-label={awaitingAsset ? "Loading market" : undefined}>
      <AssetSelector loading={awaitingAsset} label="base asset" asset={pair.base} assets={assets} excludedId={pair.quote.assetId} disabled={tradingBusy || awaitingAsset} catalogUnavailable={catalogUnavailable} retryCatalog={retryCatalog} catalogRetrying={catalogRetrying} onSelect={onSelect} />
    </div>
    <div className="min-w-0 text-left sm:min-w-40"><span className="hidden text-[11px] uppercase tracking-wider text-muted-foreground sm:block">Price</span><div className="flex h-6 min-w-0 items-center whitespace-nowrap font-mono text-lg font-bold leading-6 tabular-nums"><MeasuredSkeleton loading={statsLoading} label="Loading price">{statsLoading || headerPrice != null ? <FormattedNumber value={statsLoading ? 4.25 : headerPrice} format="price" symbol={mobile ? undefined : "USD"} /> : "-"}</MeasuredSkeleton></div><div className={`flex items-center gap-1 whitespace-nowrap font-mono text-[11px] tabular-nums sm:hidden ${headerChange != null && headerChange > 0 ? "text-market-up" : headerChange != null && headerChange < 0 ? "text-market-down" : "text-muted-foreground"}`}>{priceChange}</div></div>
    <Button variant="outline" size="icon-sm" className="sm:hidden" aria-label={marketStatsOpen ? "Hide market statistics" : "Show market statistics"} aria-expanded={marketStatsOpen} aria-controls="mobile-market-statistics" onClick={() => setMarketStatsOpen(open => !open)}><ChevronDown className={marketStatsOpen ? "rotate-180" : undefined}/></Button>
    <div id="mobile-market-statistics" className={`col-span-3 min-w-0 gap-6 overflow-x-auto [&>div]:shrink-0 sm:contents ${marketStatsOpen ? "flex" : "hidden"}`}><div className="hidden min-w-0 sm:block sm:min-w-44"><span className="block text-[11px] uppercase tracking-wider text-muted-foreground">24h change</span><div className={`flex h-6 items-center gap-1 whitespace-nowrap font-mono text-xs tabular-nums ${headerChange != null && headerChange > 0 ? "text-market-up" : headerChange != null && headerChange < 0 ? "text-market-down" : "text-muted-foreground"}`}>{priceChange}</div></div>
    <div className="min-w-0 sm:min-w-20"><span className="block text-[11px] uppercase tracking-wider text-muted-foreground">24h volume</span><div className="flex h-6 items-center whitespace-nowrap font-mono text-xs font-medium tabular-nums text-foreground/80"><MeasuredSkeleton loading={statsLoading} label="Loading volume">{statsLoading || headerVolume != null ? <FormattedNumber value={statsLoading ? 1000000 : headerVolume} format="compact" intl={{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}} /> : "-"}</MeasuredSkeleton></div></div>
    <div className="min-w-0 sm:min-w-20" title="Market cap · CoinGecko"><span className="block text-[11px] uppercase tracking-wider text-muted-foreground">Market cap</span><div className="flex h-6 items-center whitespace-nowrap font-mono text-xs font-medium tabular-nums text-foreground/80"><MeasuredSkeleton loading={capLoading} label="Loading market cap">{capLoading || headerCap != null ? <FormattedNumber value={capLoading ? 1000000000 : headerCap} format="compact" intl={{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}} /> : "-"}</MeasuredSkeleton></div></div>
    {!awaitingAsset && <TokenProjectLinks asset={pair.base} />}
    </div>
  </header>;
}
