import type { NativeIndicator, NativeIndicatorDescriptor } from "@luxalgo/vela/plugin";
import { tickerOf } from "@/lib/market-data/chart-feed";

/** A horizontal line the Terminal draws on the chart: an open order or a Jev entry level. */
export type ChartLine = { id: string; price: number; text: string; color: string; textColor: string; dashed?: boolean };

/** The native indicator type that draws the Terminal's lines. */
export const CHART_LINES = "dya-lines";

type Entry = { lines: readonly ChartLine[]; listeners: Set<() => void> };
// Lines by chart ticker. They are never drawings: private positions stay out of saved charts, undo and the object tree.
const entries = new Map<string, Entry>();
const entryFor = (ticker: string) => {
  let entry = entries.get(ticker);
  if (!entry) entries.set(ticker, entry = { lines: [], listeners: new Set() });
  return entry;
};

/** Shows `lines` on the chart of `ticker`, replacing the previous set. Returns the clear. */
export function showChartLines(ticker: string, lines: readonly ChartLine[]) {
  const entry = entryFor(ticker);
  entry.lines = lines;
  for (const listener of entry.listeners) listener();
  return () => {
    if (entry.lines !== lines) return;
    entry.lines = [];
    for (const listener of entry.listeners) listener();
    if (!entry.listeners.size) entries.delete(ticker);
  };
}

/**
 * Each line runs across the whole chart with its text in a tag ending at the newest bar. Vela
 * patches a native's lines and labels in place (its price lines only mount once), so these are
 * Pine-style line and label drawings of the indicator, not user drawings.
 */
function createLines(): NativeIndicator {
  let release = () => {};
  let emit = () => {};
  let lastBar: number | undefined, newest = () => lastBar;
  return {
    start(ctx) {
      const ticker = tickerOf(ctx.symbol), entry = entryFor(ticker);
      newest = () => ctx.bars().at(-1)?.time;
      emit = () => {
        const bars = ctx.bars();
        const first = bars[0]?.time ?? Date.now(), last = lastBar = bars.at(-1)?.time ?? first;
        ctx.emit({
          lines: entry.lines.map(line => ({ id: line.id, paneId: "price", overlay: true, xloc: "bar_time", x1: first, y1: line.price, x2: last, y2: line.price, extend: "both", color: line.color, invisible: false, width: 1, style: line.dashed ? "dashed" : "solid", arrowLeft: false, arrowRight: false })),
          labels: entry.lines.map(line => ({ id: `${line.id}-label`, paneId: "price", overlay: true, xloc: "bar_time", x: last, y: line.price, yloc: "price", text: line.text, style: "label_right", color: line.color, textColor: line.textColor, size: "small", textAlign: "left", fontFamily: "default" })),
        });
      };
      entry.listeners.add(emit);
      release = () => { entry.listeners.delete(emit); if (!entry.listeners.size && !entry.lines.length) entries.delete(ticker); };
      emit();
    },
    // A new bar moves the tags to it; ticks of the same bar change nothing.
    onBars() { if (newest() !== lastBar) emit(); },
    onViewport() {},
    setInputs() {},
    suspend() {},
    resume() { emit(); },
    stop() { release(); release = () => {}; emit = () => {}; },
  };
}

/** The Terminal's lines as a Vela native indicator. */
export const chartLinesIndicator: NativeIndicatorDescriptor = {
  type: CHART_LINES,
  title: "Terminal lines",
  paneHint: "price",
  overlay: true,
  // Owned by the Terminal (orders, Insights' Show chart levels): no legend row, never in the indicator picker.
  legend: false,
  isSupported: () => false,
  inputsSchema: () => [],
  defaultInputs: () => ({}),
  create: createLines,
};
