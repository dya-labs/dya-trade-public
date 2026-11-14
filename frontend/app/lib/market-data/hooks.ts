import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataApi, type DataMarket, type Ticker } from "./api";
import type { ChartMarket } from "./chart-feed";
import { MarketStream } from "./stream";

const origin = import.meta.env.VITE_DATA_API_ORIGIN || "http://127.0.0.1:8080";
export const dataApi = new DataApi(origin);
let stream: MarketStream | undefined;
/** The tab's single data-API WebSocket, created on first use. */
export function marketStream() {
  stream ??= new MarketStream(`${origin.replace(/^http/, "ws")}/v1/stream`);
  return stream;
}

export function useDataMeta() {
  return useQuery({ queryKey: ["data-api", "meta"], queryFn: ({ signal }) => dataApi.meta(signal), staleTime: 60_000, retry: 2 });
}

function useMarketsQuery() {
  return useQuery({ queryKey: ["data-api", "markets"], queryFn: ({ signal }) => dataApi.markets(signal), staleTime: 60_000, retry: 2 });
}

/** The data API's degraded-upstream report from `/v1/markets` (shared query, no extra request); `null` when healthy or unknown. */
export function useDataDegraded() {
  return useMarketsQuery().data?.degraded ?? null;
}

/** `venue` and `sourceLabel` name the exchange internally (Jev, saved layouts); the UI calls it the reference. */
export type AssetMarket = ChartMarket & { assetId: string; venue: string; sourceLabel: string };

/** Keyed on values, so refetches don't hand the chart new objects (which would rebuild the widget). */
function useListedMarket(assetId: string, loaded: boolean, item: DataMarket | undefined) {
  const [id, venue, base, quote, sourceLabel, firstOpenTime] = [item?.id, item?.venue, item?.base, item?.quote, item?.sourceLabel, item?.firstOpenTime];
  return useMemo<AssetMarket | null | undefined>(
    () => !loaded ? undefined : id && venue && base && quote && sourceLabel && firstOpenTime !== undefined ? { id, assetId, venue, base, quote, sourceLabel, firstOpenTime } : null,
    [loaded, id, assetId, venue, base, quote, sourceLabel, firstOpenTime],
  );
}

/**
 * The asset's reference market (its best-ranked non-Intents data-API market) and its public NEAR
 * Intents market, which the chart overlays. Each is `null` when the registry lists none and
 * `undefined` while loading.
 */
export function useAssetMarket(assetId: string) {
  const assets = useQuery({ queryKey: ["data-api", "assets"], queryFn: ({ signal }) => dataApi.assets(signal), staleTime: 60_000, retry: 2 });
  const markets = useMarketsQuery();
  const asset = assets.data?.assets.find(item => item.assetId === assetId);
  const listed = asset?.primaryMarket ? [asset.primaryMarket, ...asset.alternatives].flatMap(id => markets.data?.markets.find(item => item.id === id && item.assetId === assetId) ?? []) : [];
  const loaded = !!assets.data && !!markets.data;
  const market = useListedMarket(assetId, loaded, listed.find(item => item.venue !== "intents"));
  const intentsMarket = useListedMarket(assetId, loaded, listed.find(item => item.venue === "intents"));
  return { market, intentsMarket, error: assets.error ?? markets.error, isPending: assets.isPending || markets.isPending, retry: () => { void assets.refetch(); void markets.refetch(); } };
}

/** NEAR Intents trades (public, plus confidential ones where the market includes them) for `marketId`, refreshed every 5 s while shown. */
export function useIntentsTrades(marketId: string | undefined) {
  return useQuery({
    enabled: !!marketId,
    queryKey: ["data-api", "intents-trades", marketId],
    queryFn: ({ signal }) => dataApi.intentsTrades(marketId!, signal),
    refetchInterval: query => query.state.error ? 30_000 : 5_000,
    retry: 2,
  });
}

export function useStreamStatus() {
  return useSyncExternalStore(listener => marketStream().onStatus(listener), () => marketStream().getStatus(), () => "idle" as const);
}

/**
 * 24h ticker for a market: seeded from REST, then pushed by the stream about once a second.
 * Prefer the newer venue event (then receipt time). The chosen snapshot must be
 * under 30 s old locally; a chosen stream snapshot also needs an open connection.
 */
export function useMarketTicker(marketId: string | undefined) {
  const seed = useQuery({
    enabled: !!marketId,
    queryKey: ["data-api", "ticker", marketId],
    queryFn: async ({ signal }) => ({ ticker: (await dataApi.tickers([marketId!], signal)).find(item => item.market === marketId), receivedAt: Date.now() }),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const { refetch } = seed;
  const [pushed, setPushed] = useState<{ marketId: string; ticker: Ticker; receivedAt: number } | null>(null);
  const status = useStreamStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!marketId) return;
    return marketStream().subscribe({ type: "ticker", market: marketId }, {
      ticker: ticker => setPushed(previous => previous?.marketId === marketId && previous.ticker.eventTime > ticker.eventTime
        ? previous : { marketId, ticker, receivedAt: Date.now() }),
      resync: () => { void refetch(); },
    });
  }, [marketId, refetch]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);
  const streamed = pushed && pushed.marketId === marketId ? pushed : undefined;
  const rest = seed.data?.ticker ? seed.data : undefined;
  // A retained stream snapshot must not eclipse a newer REST recovery result.
  // Freshness belongs to the selected snapshot, never to the other transport.
  const useStream = !!streamed && (!rest?.ticker || streamed.ticker.eventTime > rest.ticker.eventTime ||
    (streamed.ticker.eventTime === rest.ticker.eventTime && streamed.receivedAt >= rest.receivedAt));
  const selected = useStream ? streamed : rest;
  const ticker = selected?.ticker;
  const live = !!ticker && !!selected && now - selected.receivedAt < 30_000 && (!useStream || status === "open");
  return { ticker, live, status, isPending: !!marketId && !ticker && seed.isPending, error: seed.error };
}
