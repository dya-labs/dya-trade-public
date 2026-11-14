"use client";

import { TableSkeletonRows } from "@dya/ui/components/table-skeleton";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { Button } from "@dya/ui/components/button";
import { Fragment, useState } from "react";
import { Table, TableBody, TableCell, TableRow } from "@dya/ui/components/table";
import type { CatalogAsset } from "../lib/near/domain/catalog";
import { D } from "../lib/near/domain/decimal";
import { networkName as legacyNetworkName } from "../lib/near/domain/deposit-assets";
import type { Network } from "../../../wallet-contracts/src/domain/networks";
import { AssetMark } from "./near/asset-mark";
import { NetworkMark } from "./near/network-mark";

type Holding = { assetId: string; symbol: string; decimals: number; raw: string; amount: string };
export function groupWalletAssets(holdings: Holding[], catalog: CatalogAsset[]) {
  const metadata = new Map(catalog.map(asset => [asset.assetId, asset]));
  const groups = new Map<string, { key: string; asset: CatalogAsset; amount: string; holdings: { holding: Holding; asset?: CatalogAsset }[] }>();
  for (const holding of holdings) {
    const asset = metadata.get(holding.assetId);
    // Follow the catalog identity rule used by depositSources, never ticker alone.
    const key = asset?.coingeckoId ? JSON.stringify([asset.coingeckoId, asset.symbol]) : holding.assetId;
    const group = groups.get(key) ?? { key, asset: asset ?? { ...holding, blockchain: "unknown" }, amount: "0", holdings: [] };
    group.amount = new D(group.amount).add(holding.amount).toFixed();
    group.holdings.push({ holding, asset });
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function WalletAssets({ holdings, catalog, networks, limit, pageSize, loading = false }: { loading?: boolean; holdings: Holding[]; catalog: CatalogAsset[]; networks?: Network[]; limit?: number; pageSize?: number }) {
  const networkName = (id: string) => networks?.find(n => n.id === id)?.name ?? legacyNetworkName(id);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [visible, setVisible] = useState(pageSize ?? 20);
  const groups = groupWalletAssets(holdings, catalog);
  const count = limit ?? (pageSize ? visible : groups.length);
  return <><Table aria-label="Asset balances" columnWidths={["60%", "40%"]} loading={loading} loadingLabel="Loading assets"><TableBody>{loading && <TableSkeletonRows columns={2} rows={2} className="h-15" cellClassName="p-3" />}{groups.slice(0, count).map(group => {
    const symbol = group.asset.assetId === "nep141:wrap.near" ? "NEAR" : group.asset.symbol;
    const networks = new Set(group.holdings.map(item => item.asset?.blockchain ?? item.holding.assetId)).size;
    const expandable = group.holdings.length > 1;
    const open = expanded.has(group.key);
    const toggle = () => setExpanded(previous => { const next = new Set(previous); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; });
    return <Fragment key={group.key}><TableRow className={expandable ? "cursor-pointer" : undefined} onClick={expandable ? toggle : undefined}><TableCell className="p-3">{expandable ? <button type="button" className="flex cursor-pointer items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-ring" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${symbol} networks`} onClick={event => { event.stopPropagation(); toggle(); }}><AssetMark asset={group.asset} size={36} networkCount={networks} /><span>{symbol}</span></button> : <span role="img" aria-label={`${symbol} on ${group.holdings[0].asset ? networkName(group.asset.blockchain) : "unknown network"}`} className="flex items-center gap-3"><AssetMark asset={group.asset} size={36} /><span>{symbol}</span></span>}</TableCell><TableCell className="break-all p-3 text-right"><FormattedNumber value={group.amount} unit={group.asset.symbol} exactTooltip /></TableCell></TableRow>{expandable && open && group.holdings.map(({ holding, asset }) => <TableRow key={holding.assetId}><TableCell className="p-3"><div className="flex items-center gap-3 pl-6"><NetworkMark network={asset?.blockchain ?? "unknown"} size={24} /><span>{asset ? networkName(asset.blockchain) : "Network unavailable"}</span></div></TableCell><TableCell className="break-all p-3 text-right"><FormattedNumber value={holding.amount} unit={holding.symbol} exactTooltip /></TableCell></TableRow>)}</Fragment>;
  })}</TableBody></Table>{pageSize && groups.length > count && <Button variant="outline" className="m-3" onClick={() => setVisible(n => n + pageSize)}>Load more</Button>}</>;
}
