"use client";
import { useHapticFeedback } from "@dya/ui/hooks/use-haptic-feedback";
import { useIsMobile } from "@dya/ui/hooks/use-mobile";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { ChevronDown, ChevronUpIcon, LoaderCircle } from "@dya/ui/icons";
import { AssetMark } from "./asset-mark";
import { useQuery } from "@tanstack/react-query";
import { getTokenMarkets } from "@/lib/near/http/catalog-client";
import { MeasuredSkeleton, SkeletonCell } from "@dya/ui/components/skeleton";
import { useMemo, useRef, useState } from "react";
import { Button } from "@dya/ui/components/button";
import { Input } from "@dya/ui/components/input";
import { DialogDrawer, DialogDrawerContent, DialogDrawerHeader, DialogDrawerTitle, DialogDrawerDescription } from "@dya/ui/components/dialog-drawer";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import type { CatalogAsset } from "@/lib/near/domain/catalog";
import { TOKEN_MARKETS_FRESH_MS } from "@/lib/near/domain/token-icons";

import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { TableSkeletonRows } from "@dya/ui/components/table-skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dya/ui/components/table";

type TokenRow = { asset: CatalogAsset; token: string; price?: number; change24h?: number; volume24h?: number; marketCap?: number };
const columns: ColumnDef<TokenRow>[] = [
  { accessorKey: "token", header: "Token", sortingFn: "alphanumeric", sortDescFirst: false },
  { accessorKey: "price", header: "Price", sortingFn: "basic", sortUndefined: "last" },
  { accessorKey: "change24h", header: "24h change", sortingFn: "basic", sortUndefined: "last" },
  { accessorKey: "volume24h", header: "24h volume", sortingFn: "basic", sortUndefined: "last" },
  { accessorKey: "marketCap", header: "Market cap", sortingFn: "basic", sortUndefined: "last" },
];



export function AssetSelector({ label, asset, assets, excludedId, disabled, onSelect, catalogUnavailable = false, retryCatalog, catalogRetrying = false, loading = false }: {
  loading?: boolean; label: string; asset: CatalogAsset; assets: CatalogAsset[]; excludedId: string; disabled?: boolean;
  catalogUnavailable?: boolean; retryCatalog?: () => void; catalogRetrying?: boolean;
  onSelect: (asset: CatalogAsset) => void;
}) {
  const feedback = useHapticFeedback();
  const mobile = useIsMobile(640);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const hoveredRow = useRef<string | null>(null);
  const [instantHover, setInstantHover] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: "volume24h", desc: true }]);
  const markets = useQuery({ queryKey: ["near", "token-markets"], queryFn: ({ signal }) => getTokenMarkets(signal), enabled: open, staleTime: 300000, refetchInterval: query => open ? query.state.error ? 30000 : 300000 : false });
  const loadingCatalog = catalogRetrying && !assets.length;
  const data = useMemo(() => assets.filter(a => a.assetId !== excludedId).map(a => {
    const metrics = markets.data?.assets[a.assetId];
    return { asset: a, token: displaySymbol(a), price: metrics?.price ?? undefined, change24h: metrics?.change24h ?? undefined, volume24h: metrics?.volume24h ?? undefined, marketCap: metrics?.marketCap ?? undefined };
  }), [assets, excludedId, markets.data]);
  // TanStack Table manages sorting/filtering; token buttons provide keyboard selection.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data, columns, state: { sorting, globalFilter: search, columnVisibility: mobile ? { change24h: false, marketCap: false } : {} }, onSortingChange: setSorting,
    getRowId: row => row.asset.assetId, enableSortingRemoval: false,
    globalFilterFn: (row, _column, value) => `${row.original.token} ${row.original.asset.symbol}`.toLowerCase().includes(String(value).trim().toLowerCase()),
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), getSortedRowModel: getSortedRowModel(),
  });
  const rows = table.getRowModel().rows;
  return <>
    <Button variant="ghost" className="w-fit max-w-full min-w-0 justify-start border-0 bg-transparent p-0 text-lg active:bg-transparent dark:active:bg-transparent hover:bg-transparent hover:text-current aria-expanded:bg-transparent aria-expanded:text-current dark:hover:bg-transparent" disabled={disabled || loading} aria-label={`Select market: ${displaySymbol(asset)}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setSearch(""); setOpen(true); }}>
      <MeasuredSkeleton loading={loading} label="Loading market icon" className="shrink-0"><AssetMark key={asset.assetId} asset={asset} /></MeasuredSkeleton>
      <MeasuredSkeleton loading={loading} label="Loading market name" className="min-w-0 truncate text-left"><span title={loading ? undefined : displaySymbol(asset)}>{displaySymbol(asset)}</span></MeasuredSkeleton>
      <ChevronDown aria-hidden="true" className={`size-5 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
    </Button>
    <DialogDrawer open={open} onOpenChange={setOpen}><DialogDrawerContent className="max-h-[85vh] max-sm:gap-0 max-sm:pb-0 sm:max-w-3xl">
      <DialogDrawerHeader><DialogDrawerTitle>Select {label}</DialogDrawerTitle><DialogDrawerDescription className="sr-only">All tokens trade against USDC. Global market data in USD from CoinGecko or CoinMarketCap.</DialogDrawerDescription></DialogDrawerHeader>
      <div className="-mx-3 flex max-h-[calc(55vh+5rem)] min-h-0 flex-col gap-4 overflow-y-auto px-3 pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:contents">
      {(catalogUnavailable || (catalogRetrying && !assets.length)) && <div role="status" className="flex items-center justify-between gap-2 text-sm text-muted-foreground"><span>{catalogRetrying ? "Loading markets…" : `Markets temporarily unavailable${assets.length ? ". Showing the last available list." : "."}`}</span><Button variant="outline" disabled={catalogRetrying} onClick={retryCatalog}>{catalogRetrying && <LoaderCircle  aria-hidden="true" />}{catalogRetrying ? "Loading…" : "Retry"}</Button></div>}
      <div><Input aria-label="Search tokens" placeholder="Search tokens" value={search} onChange={e => setSearch(e.target.value)} /></div>

      {!markets.isPending && (markets.error || markets.data?.updatedAt == null || Date.now() - markets.data.updatedAt > TOKEN_MARKETS_FRESH_MS) && <p role="status" className="text-sm text-muted-foreground">{markets.data?.updatedAt ? "Market data delayed. Showing last available prices." : "Market data unavailable. You can still select a token."}</p>}

      <div className="-mx-2 min-w-0 shrink-0 [&_[data-slot=table-container]]:overflow-visible sm:[&_[data-slot=table-container]]:max-h-[min(28rem,55vh)] sm:[&_[data-slot=table-container]]:overflow-auto">
        <Table loading={loadingCatalog || (markets.isPending && rows.length > 0)} loadingLabel="Loading markets" columnWidths={mobile ? ["34%", "36%", "30%"] : ["28%", "18%", "18%", "18%", "18%"]} className="w-full min-w-0 sm:min-w-[42rem] table-fixed border-separate border-spacing-0" aria-label="Token markets">
          <TableHeader className="bg-popover sm:sticky sm:top-0 sm:z-10">
            {table.getHeaderGroups().map(group => <TableRow key={group.id} className="hover:bg-transparent!">{group.headers.map(header => <TableHead key={header.id} className={header.id === "token" ? "pl-2 sm:w-[28%]" : "pr-2 sm:w-[18%]"} aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : "none"}>
              <Button variant="ghost" size="sm" className={`w-full border-0 px-0 text-muted-foreground hover:bg-transparent! hover:text-foreground dark:hover:bg-transparent! ${header.id === "token" ? "justify-start" : "justify-end"}`} onClick={header.column.getToggleSortingHandler()} aria-label={`Sort by ${String(header.column.columnDef.header)}`}>
                {mobile && header.id === "volume24h" ? "24h vol." : flexRender(header.column.columnDef.header, header.getContext())}
                {header.column.getCanSort() && <span aria-hidden="true" className="flex h-4 shrink-0 flex-col justify-center -space-y-1">
                  <ChevronUpIcon className={`size-3! ${header.column.getIsSorted() === "asc" ? "text-foreground" : "text-muted-foreground/40"}`} />
                  <ChevronDown className={`size-3! ${header.column.getIsSorted() === "desc" ? "text-foreground" : "text-muted-foreground/40"}`} />
                </span>}
              </Button>
            </TableHead>)}</TableRow>)}
          </TableHeader>
          <TableBody onPointerLeave={() => { hoveredRow.current = null; setInstantHover(false); }}>
            {rows.map(row => {
              const a = row.original.asset;
              const select = () => { feedback(); onSelect(a); setOpen(false); };
              return <TableRow key={row.id} className={`group cursor-pointer hover:bg-transparent! ${instantHover ? "[&>td]:transition-none" : "[&>td]:transition-colors motion-reduce:[&>td]:transition-none"}`} onPointerEnter={() => {
                if (hoveredRow.current !== null && hoveredRow.current !== row.id) setInstantHover(true);
                hoveredRow.current = row.id;
              }} onClick={select}>
                {row.getVisibleCells().map(cell => <TableCell key={cell.id} className="h-12 py-0! first:rounded-l-[6px] last:rounded-r-[6px] first:pl-2 last:pr-2 group-hover:bg-hover! group-focus-within:bg-hover!">
                  {cell.column.id === "token" ? <Button variant="ghost" className="h-12! w-full min-w-0 justify-start border-0 px-0 hover:bg-transparent dark:hover:bg-transparent" title={a.assetId} aria-label={`Select ${displaySymbol(a)}`} onClick={event => { event.stopPropagation(); select(); }}><AssetMark asset={a} /><span className="truncate">{displaySymbol(a)}</span></Button>
                    : markets.isPending ? <SkeletonCell /> : <div className="flex flex-col items-end gap-0.5"><span className="flex justify-end tabular-nums">{cell.column.id === "change24h" ? (() => {
                      const value = cell.getValue<number | undefined>();
                      return value == null ? "-" : <span className={value > 0 ? "text-market-up" : value < 0 ? "text-market-down" : undefined}><FormattedNumber value={value / 100} intl={{style:"percent",minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:"exceptZero"}} /></span>;
                    })() : <FormattedNumber value={cell.getValue<number | undefined>()} format={cell.column.id === "price" ? "price" : "compact"} intl={{style:"currency",currency:"USD",...(cell.column.id === "price" ? {maximumSignificantDigits:6} : {notation:"compact",maximumFractionDigits:2})}} />}</span>{mobile && cell.column.id === "price" && <span className={`text-xs tabular-nums ${row.original.change24h == null ? "text-muted-foreground" : row.original.change24h > 0 ? "text-market-up" : row.original.change24h < 0 ? "text-market-down" : "text-muted-foreground"}`}><span className="sr-only">24h change: </span><FormattedNumber value={row.original.change24h == null ? null : row.original.change24h / 100} intl={{style:"percent",minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:"exceptZero"}}/></span>}</div>}
                </TableCell>)}
              </TableRow>;
            })}
            {loadingCatalog && <TableSkeletonRows columns={table.getVisibleLeafColumns().length} rows={6} />}
            {!markets.isPending && !catalogRetrying && !rows.length && !(catalogUnavailable && !assets.length) && <TableRow><TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center">No matching tokens.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      </div>
    </DialogDrawerContent></DialogDrawer>
  </>;
}
