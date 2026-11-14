import type { OHLCV } from "@luxalgo/vela";
import type { NativeIndicator, NativeIndicatorContext, NativeIndicatorDescriptor, RendererLayerDefinition, WidgetActionDescriptor } from "@luxalgo/vela/plugin";
import { INTENTS_LABEL, intervalFor, tickerOf, type BarSource, type ChartMarket } from "./chart-feed";

/** The native indicator type and renderer layer that draw a chart's NEAR Intents swaps. */
export const INTENTS_OVERLAY = "near-intents";

type OverlaySource = { source: BarSource; market: ChartMarket; color: string };
type OverlayData = { bars: readonly OHLCV[]; color: string };

// The chart's ticker names the source its overlay reads; the Terminal provides it while the chart lives.
const sources = new Map<string, OverlaySource>();

/** Lets the overlay of the chart of `ticker` read `market`. Returns the release. */
export function provideIntentsOverlay(ticker: string, overlay: OverlaySource) {
  sources.set(ticker, overlay);
  return () => { if (sources.get(ticker) === overlay) sources.delete(ticker); };
}

/** The topbar buttons that show and hide the overlay; one of them renders at a time. */
export const INTENTS_TOGGLE_ACTIONS = { show: "dya.intents.show", hide: "dya.intents.hide" } as const;
type IntentsToggle = { visible: boolean; toggle(): void };
const toggles = new Map<string, IntentsToggle>();

/** Puts the overlay's Show/Hide button on the chart of `ticker`. Returns the release. */
export function provideIntentsToggle(ticker: string, toggle: IntentsToggle) {
  toggles.set(ticker, toggle);
  return () => { if (toggles.get(ticker) === toggle) toggles.delete(ticker); };
}

/**
 * One overlay instance: the Intents bars of the chart's timeframe from the chart's first bar on,
 * then live bars. Hidden, it stops fetching and paints nothing; shown again, it reloads.
 */
function createOverlay(): NativeIndicator {
  let ctx: NativeIndicatorContext | undefined;
  let stopLive = () => {};
  // Older history scrolled into the chart: the overlay follows it back.
  let reload = () => {};
  let generation = 0, from = Infinity;
  let bars: OHLCV[] = [];

  const close = () => {
    generation++;
    stopLive(); stopLive = () => {}; reload = () => {};
    bars = []; from = Infinity;
    ctx?.pushData(undefined);
  };
  const open = () => {
    const overlay = ctx && sources.get(tickerOf(ctx.symbol));
    const interval = ctx && intervalFor(ctx.timeframe);
    if (!ctx || !overlay || !interval) return;
    const current = ctx, run = generation;
    const push = () => current.pushData({ bars, color: overlay.color } satisfies OverlayData);
    const load = (start: number) => {
      from = start;
      void overlay.source.history(overlay.market, interval, { from: start }).then(history => {
        if (run !== generation) return;
        // Live bars that arrived during the load are newer than its last bar.
        bars = [...history, ...bars.filter(bar => bar.time > (history.at(-1)?.time ?? -Infinity))];
        push();
      }).catch(() => {});
    };
    load(current.bars()[0]?.time ?? Date.now());
    reload = () => { const first = current.bars()[0]?.time; if (first !== undefined && first < from) load(first); };
    stopLive = overlay.source.live(overlay.market, interval, bar => {
      if (run !== generation) return;
      const last = bars.at(-1);
      if (last && bar.time < last.time) return;
      bars = last?.time === bar.time ? [...bars.slice(0, -1), bar] : [...bars, bar];
      push();
    });
  };

  return {
    start(context) { ctx = context; open(); },
    onBars() { reload(); },
    onViewport() {},
    setInputs() {},
    suspend() { close(); },
    resume() { open(); },
    stop() { close(); ctx = undefined; },
  };
}

/** The overlay as a Vela native indicator. */
export const intentsOverlayIndicator: NativeIndicatorDescriptor = {
  type: INTENTS_OVERLAY,
  title: INTENTS_LABEL,
  paneHint: "price",
  overlay: true,
  // The Terminal's own Show/Hide Intents control owns it: no legend row, never in the indicator picker.
  legend: false,
  isSupported: () => false,
  inputsSchema: () => [],
  defaultInputs: () => ({}),
  create: createOverlay,
};

/** The renderer layer that paints the overlay's bars on the reference price scale. */
export const intentsOverlayLayer: RendererLayerDefinition = {
  id: INTENTS_OVERLAY,
  placement: "above-data",
  create() {
    let canvas: HTMLCanvasElement | undefined;
    return {
      mount(element) { canvas = element; },
      render({ data, coords, scale, bounds }) {
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        const overlay = data as OverlayData | undefined;
        if (!overlay?.bars.length) return;
        const dpr = coords.dpr, spacing = coords.bodySpacing();
        const { from, to } = coords.visibleTimeRange();
        const margin = coords.barInterval || 0;
        // OHLC bars: a high-low stem, the open to its left and the close to its right.
        const tick = Math.max(1, Math.round(spacing * 0.35)), width = Math.max(1, Math.min(3, Math.round(spacing * 0.15)));
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.strokeStyle = overlay.color;
        context.lineWidth = width;
        context.beginPath();
        for (const bar of overlay.bars) {
          if (bar.time < from - margin || bar.time > to + margin) continue;
          const x = Math.round(coords.timeToX(bar.time)) + (width % 2 ? 0.5 : 0);
          const y = (price: number) => coords.priceToY(price, scale, bounds);
          context.moveTo(x, y(bar.high)); context.lineTo(x, y(bar.low));
          context.moveTo(x - tick, y(bar.open)); context.lineTo(x, y(bar.open));
          context.moveTo(x, y(bar.close)); context.lineTo(x + tick, y(bar.close));
        }
        context.stroke();
      },
    };
  },
};

/** Show Intents and Hide Intents, left in the chart's topbar; `when` keeps one of them. */
export const intentsToggleActions: WidgetActionDescriptor[] = ([[INTENTS_TOGGLE_ACTIONS.show, "Show Intents", false], [INTENTS_TOGGLE_ACTIONS.hide, "Hide Intents", true]] as const).map(([id, label, visible]) => ({
  id, label, target: "topbar", align: "left", mobile: "menu",
  when: ctx => toggles.get(tickerOf(ctx.symbol))?.visible === visible,
  run: ctx => toggles.get(tickerOf(ctx.symbol))?.toggle(),
}));
