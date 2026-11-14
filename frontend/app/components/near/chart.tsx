"use client";
import type { ChartOrderLine } from "./chart-orders";
import { DyaLoader } from "@dya/ui/components/dya-loader";
import { formatNumber } from "@dya/ui/lib/format-number";
import { useMachine } from "@dya/ui/hooks/use-machine";
import { Button } from "@dya/ui/components/button";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { z } from "zod";
import type { IndicatorHandle } from "@luxalgo/vela";
import type { VelaStorage } from "@luxalgo/vela/widget";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { createLocalPreference } from "@/lib/local-storage";
import type { EntryPlan } from "@/lib/analysis/entry-analysis";
import { DEFAULT_PAIR, type CatalogAsset } from "@/lib/near/domain/catalog";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { dataApi, marketStream, useAssetMarket, useDataMeta, useMarketTicker } from "@/lib/market-data/hooks";
import { themeTokens } from "@/lib/chart-theme";
import { createBarSource, priceScaleFor, REFERENCE_LABEL, TIMEFRAME_BY_INTERVAL } from "@/lib/market-data/chart-feed";
import { INTENTS_OVERLAY, INTENTS_TOGGLE_ACTIONS, provideIntentsOverlay, provideIntentsToggle } from "@/lib/market-data/intents-overlay";
import { CHART_LINES, showChartLines, type ChartLine } from "./chart-lines";
import { chartView, INITIAL_CHART_STATE, nextChart } from "./chart-lifecycle";

type VelaRuntime = typeof import("./vela-runtime");

const intentsOverlayPreference = createLocalPreference("nervana:intents-overlay:v1", z.boolean());

// Colors Vela saves in a chart's renderer config that come from the app theme. A chart saved under
// another palette (the other app theme, or tokens since changed) drops them on load and takes the
// current theme's; the user's other settings stay.
const THEME_COLORS: readonly (readonly string[])[] = [
  ["layout", "background"], ["layout", "textColor"], ["grid", "vertLines", "color"], ["grid", "horzLines", "color"],
  ["priceScale", "borderColor"], ["panes", "separatorColor"],
  ...["upColor", "downColor", "borderUpColor", "borderDownColor", "wickUpColor", "wickDownColor"].map(key => ["candles", key]),
  ["bars", "upColor"], ["bars", "downColor"], ["columns", "upColor"], ["columns", "downColor"],
];
// Zoom and pan never glide (see `animations` below; their settings are hidden). Vela saves every
// motion setting, so charts saved before then, with motion on, drop them on load.
const MOTION: readonly (readonly string[])[] = [["animations", "zoom"], ["animations", "pan"], ["animations", "autoscale"]];
// Vela zooms out only as far as the loaded bars and loads no more on the way, so the chart loads
// enough for TradingView's zoom-out, where bodies thin to wicks (under 3px a bar). The settings'
// "Bars to fetch" still changes it.
const CHART_BARS = 5000;
const savedCharts = z.object({ charts: z.array(z.object({ bars: z.number().optional(), rendererConfig: z.record(z.string(), z.unknown()).optional() }).passthrough()) }).passthrough();
/**
 * A saved chart as it loads: without the renderer settings at `paths`, and with the chart's depth
 * when it saved none (Vela restores a saved chart without the workspace's `bars`).
 */
function restored(saved: string, paths: readonly (readonly string[])[]) {
  const document = savedCharts.safeParse(JSON.parse(saved));
  if (!document.success) return saved;
  let changed = false;
  // The config's sections are unknown values, kept as parsed: walk them by reference.
  for (const chart of document.data.charts) {
    if (chart.bars === undefined) { chart.bars = CHART_BARS; changed = true; }
    for (const path of paths) {
      const parent = path.slice(0, -1).reduce<unknown>((node, key) => node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined, chart.rendererConfig);
      const key = path.at(-1)!;
      if (parent && typeof parent === "object" && key in parent) { delete (parent as Record<string, unknown>)[key]; changed = true; }
    }
  }
  return changed ? JSON.stringify(document.data) : saved;
}

/**
 * The chart's saved state in this browser, stamped with the theme `palette` it was saved under. A
 * failed save is reported, never thrown. The Terminal's own indicators (the Intents overlay, order
 * and level lines) have no legend; they are added fresh on every load.
 */
function chartStorage(palette: string, onSave: (saved: boolean) => void): VelaStorage {
  return {
    get(key) {
      try {
        const saved = window.localStorage.getItem(key);
        return saved === null ? null : restored(saved, window.localStorage.getItem(`${key}:palette`) === palette ? MOTION : [...THEME_COLORS, ...MOTION]);
      } catch { return null; }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, value); window.localStorage.setItem(`${key}:palette`, palette); onSave(true); }
      catch { onSave(false); }
    },
    remove(key) { try { window.localStorage.removeItem(key); window.localStorage.removeItem(`${key}:palette`); } catch { /* Storage is optional. */ } },
  };
}

let builds = 0;

/** `entryPlan` is Jev's plan for this asset's reference market, if any; the Terminal owns the analysis. */
const NO_ORDER_LINES: ChartOrderLine[] = [];
export function NearChart({ asset = DEFAULT_PAIR.base, entryPlan, orderLines = NO_ORDER_LINES, analysisMessage = "" }: { asset?: CatalogAsset; entryPlan?: EntryPlan | null; orderLines?: ChartOrderLine[]; analysisMessage?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<{ runtime: VelaRuntime; workspace: VelaWorkspace; overlay: IndicatorHandle | null } | null>(null);
  const [state, send] = useMachine(nextChart, INITIAL_CHART_STATE);
  const [saveError, setSaveError] = useState("");
  // The Intents overlay is off unless the user turned it on; the choice is remembered across sessions.
  const [showIntents, setShowIntents] = useState(() => intentsOverlayPreference.read() ?? false);
  const { resolvedTheme } = useTheme();
  // The reference market is the chart; the asset's public NEAR Intents swaps are overlaid on it.
  const { market, intentsMarket, error: marketError, retry: retryMarket } = useAssetMarket(asset.assetId);
  const symbol = displaySymbol(asset);
  // The chart names the market by its token symbol in USD whatever stablecoin the reference is quoted in.
  const ticker = `${symbol}/USD`;
  const meta = useDataMeta();
  const { ticker: marketTicker } = useMarketTicker(market?.id);
  const revision = meta.data?.revision;
  const intervalsKey = meta.data?.intervals.join(",");
  const refetchMeta = meta.refetch;
  // Catalog prices refresh often; only a change of magnitude may rebuild the chart.
  const pricescale = market ? priceScaleFor(market, Number(asset.price)) : undefined;

  useEffect(() => {
    if (!host.current || !market || !pricescale || !revision || !intervalsKey) return;
    const build = ++builds;
    send({ type: "build", build });
    setSaveError("");
    let cancelled = false;
    let unmount = () => {};
    // Vela loads with the first chart, after the Terminal has painted.
    void import("./vela-runtime").then(runtime => {
      if (cancelled || !host.current) return;
      unmount = mount(runtime, host.current);
    }, () => { if (!cancelled) send({ type: "failed", build, message: "The chart failed to load." }); });
    return () => { cancelled = true; unmount(); };

    function mount(runtime: VelaRuntime, element: HTMLDivElement) {
      const intervals = intervalsKey!.split(",").filter(interval => interval in TIMEFRAME_BY_INTERVAL);
      const source = createBarSource({ api: dataApi, stream: marketStream(), revision: revision!, onStale: () => { void refetchMeta(); } });
      const provider = runtime.createReferenceProvider({ source, market: market!, ticker, intervals, mintick: 1 / pricescale! });
      const token = themeTokens(element);
      const intents = token("market-intents");
      // Half-transparent so the reference candles stay readable under the sparse Intents bars.
      const [red, green, blue] = [1, 3, 5].map(offset => parseInt(intents.slice(offset, offset + 2), 16));
      const releaseOverlay = intentsMarket ? provideIntentsOverlay(ticker, { source, market: intentsMarket, color: `rgba(${red}, ${green}, ${blue}, 0.5)` }) : () => {};
      const decimals = Math.round(Math.log10(pricescale!));
      const theme = runtime.createChartTheme(token, resolvedTheme === "dark");
      let workspace: VelaWorkspace;
      try {
        workspace = new runtime.VelaWorkspace(element, {
          layout: false,
          symbol: `reference:${ticker}`,
          timeframe: TIMEFRAME_BY_INTERVAL["15m"],
          timeframes: intervals.map(interval => TIMEFRAME_BY_INTERVAL[interval]!),
          live: true,
          bars: CHART_BARS,
          theme,
          providers: { reference: () => provider },
          timezone: "Etc/UTC",
          locale: "en",
          watermark: false,
          // Zoom and pan move the chart at once: Vela's eased zoom, drag inertia and scroll and
          // price-scale glides make people dizzy.
          animations: { zoom: false, pan: false, scroll: false, autoscale: false },
          // No symbol search: the asset selector above the chart picks the market. Without the
          // topbar's symbol button, typing a letter opens no search either (see the Vela patch).
          topbar: { left: ["timeframes", "style", "indicators", "actions", "undo-redo"], right: ["panels", "screenshot"] },
          // Prices show the market's price step everywhere, as plain decimals (never "1.1e-7").
          formatters: { price: (value, ctx) => ctx.mode !== "price" ? ctx.fallback() : formatNumber(value, { intl: { useGrouping: ctx.grouping, minimumFractionDigits: decimals, maximumFractionDigits: decimals } }) },
          settings: { hidden: ["status-line.logo", "symbol.animation.zoom", "symbol.animation.pan", "symbol.animation.autoscale"] },
          persist: `nervana:chart:v2:${encodeURIComponent(asset.assetId)}:${market!.sourceLabel}:${market!.quote}`,
          storage: chartStorage(theme.id, saved => setSaveError(saved ? "" : "Chart changes could not be saved in this browser.")),
        });
      } catch {
        source.dispose(); releaseOverlay();
        send({ type: "failed", build, message: "The chart failed to load." });
        return () => {};
      }
      // The title reads "NEAR/USD · 15m · Reference" as before; Vela writes the venue first, in capitals.
      const title = workspace.root.querySelector(".vela-sl-meta");
      const retitle = () => {
        const match = /^· REFERENCE · (.+)$/.exec(title?.textContent ?? "");
        if (title && match) title.textContent = `· ${match[1]} · ${REFERENCE_LABEL}`;
      };
      const titles = new MutationObserver(retitle);
      if (title) { retitle(); titles.observe(title, { subtree: true, childList: true, characterData: true }); }
      const inner = workspace.chart;
      const overlay = intentsMarket ? inner.addNativeIndicator(INTENTS_OVERLAY) : null;
      overlay?.setVisible(intentsOverlayPreference.read() ?? false);
      inner.addNativeIndicator(CHART_LINES);
      chart.current = { runtime, workspace, overlay };
      const stopLoads = inner.on("load:end", ({ bars }) => {
        if (!send(bars > 0 ? { type: "loaded", build } : { type: "failed", build, message: "Market data is unavailable." }) || !bars) return;
        // The title has no symbol logo, like the reference chart before it (its settings row is hidden).
        const loaded = workspace.getState();
        if (loaded.charts.every(item => item.statuslineParts?.logo === false)) return;
        workspace.applyState({ ...loaded, charts: loaded.charts.map(item => ({ ...item, statuslineParts: { ...item.statuslineParts, logo: false } })) });
      });
      return () => {
        stopLoads();
        titles.disconnect();
        chart.current = null;
        workspace.destroy();
        source.dispose();
        releaseOverlay();
      };
    }
    // A new app theme rebuilds the chart: the saved chart reloads under the new palette.
  }, [asset.assetId, state.attempt, intentsMarket, intervalsKey, market, pricescale, refetchMeta, resolvedTheme, revision, send, ticker]);

  // The overlay is shown or hidden without rebuilding the chart. The button shows for every asset;
  // without an Intents market it only records the choice, which applies once swaps are listed.
  useEffect(() => {
    chart.current?.overlay?.setVisible(showIntents);
    const release = provideIntentsToggle(ticker, { visible: showIntents, toggle: () => { setShowIntents(!showIntents); intentsOverlayPreference.write(!showIntents); } });
    const workspace = chart.current?.workspace;
    if (!workspace) return release;
    workspace.refreshActions();
    const button = workspace.root.querySelector<HTMLElement>(`[data-action-id="${showIntents ? INTENTS_TOGGLE_ACTIONS.hide : INTENTS_TOGGLE_ACTIONS.show}"]`);
    const tooltip = button && new chart.current!.runtime.Tooltip(button, { content: intentsMarket ? "NEAR Intents swaps; some aren't indexed" : `No NEAR Intents swaps for ${symbol} yet`, host: workspace.root });
    return () => { tooltip?.destroy(); release(); };
  }, [intentsMarket, showIntents, state.build, state.phase, symbol, ticker]);

  // Open orders and Jev's entry levels are lines the Terminal draws, never drawings: private
  // positions stay out of saved charts.
  const orderLinesKey = JSON.stringify(orderLines);
  useEffect(() => {
    if (!host.current) return;
    const token = themeTokens(host.current);
    const lines: ChartLine[] = [
      ...(JSON.parse(orderLinesKey) as ChartOrderLine[]).map(line => ({ id: `order-${line.id}`, price: line.price, text: line.text, color: token(line.side === "buy" ? "market-up" : "market-down"), textColor: token("card"), dashed: true })),
      ...(entryPlan?.levels ?? []).map((level, index) => ({
        id: `level-${index}`,
        price: level.price,
        color: token("info"),
        textColor: token("card"),
        text: level.allocationPercent > 0
          ? `Entry ${index + 1} / ${level.allocationPercent}% / p${Math.round(level.reactionProbability * 100)}`
          : `Watch ${index + 1} / p${Math.round(level.reactionProbability * 100)}`,
      })),
    ];
    return showChartLines(ticker, lines);
  }, [entryPlan, orderLinesKey, resolvedTheme, ticker]);

  const view = chartView(state, {
    market: market === null ? "unlisted" : market ? "listed" : marketError ? "failed" : "loading",
    settings: meta.data ? "ready" : meta.error ? "failed" : "loading",
  });
  // The data API sends canonical decimals; Number() would print sub-1e-6 prices in exponent form.
  // Reference markets quote USD, USDC or USDT; all are shown as USD.
  const lastPrice = marketTicker ? `${formatNumber(marketTicker.lastPrice, { intl: { useGrouping: false, maximumFractionDigits: 20 } })} USD` : undefined;

  return <section className="dia-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-2">
    {analysisMessage && <p className="px-4 pb-2 text-xs text-muted-foreground">{analysisMessage}</p>}
    {saveError && <p role="status" className="px-4 pb-2 text-xs text-muted-foreground">{saveError}</p>}
    {view.kind === "unlisted" ? <div className="flex min-h-0 sm:min-h-[370px] flex-1 px-2 pb-2 lg:min-h-0">
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">Chart unavailable for {symbol}. No supported market yet.</div>
    </div> : <div className="relative isolate min-h-0 sm:min-h-[370px] flex-1 px-2 pb-1 lg:min-h-0" aria-busy={view.kind === "loading"}>
      <div ref={host} className="relative z-0 h-full min-h-0 sm:min-h-[370px] w-full lg:min-h-0" role="region" aria-label={`${ticker} ${REFERENCE_LABEL.toLowerCase()} chart${intentsMarket && showIntents ? " with NEAR Intents swaps" : ""}. ${lastPrice ? `Last price ${lastPrice}.` : "Waiting for market data."}`} />
      {view.kind === "loading" && <div className="absolute inset-0 z-10 flex items-center justify-center bg-card"><DyaLoader label="Loading chart" /></div>}
      {view.kind === "error" && <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card px-4 text-center text-xs text-muted-foreground"><span>{view.message}</span><Button size="sm" variant="outline" onClick={() => { if (view.retry === "chart") send({ type: "retry" }); else if (view.retry === "market") retryMarket(); else void meta.refetch(); }}>Retry</Button></div>}
    </div>}
  </section>;
}
