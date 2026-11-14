import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { IndicatorHandle } from "@luxalgo/vela";
import { getNativeIndicator, widgetActions, type NativeIndicatorOutput, type WidgetContext } from "@luxalgo/vela/plugin";
import type { VelaWorkspaceOptions } from "@luxalgo/vela/workspace";
import { NearChart as Chart } from "@/components/near/chart";
import type { EntryPlan } from "@/lib/analysis/entry-analysis";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";

type TestMarket = { id: string; venue: string; assetId: string; base: string; quote: string; sourceLabel: string; firstOpenTime: number };
const state = vi.hoisted(() => ({
  market: undefined as TestMarket | null | undefined,
  marketError: null as Error | null,
  intentsMarket: undefined as TestMarket | undefined,
  metaError: null as Error | null,
  retryMeta: vi.fn(),
  retryMarket: vi.fn(),
  theme: "dark",
  plan: undefined as unknown,
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: state.theme }) }));
vi.mock("@/lib/market-data/hooks", () => ({
  dataApi: {},
  marketStream: () => ({ subscribe: () => () => {} }),
  useAssetMarket: () => ({ market: state.market, intentsMarket: state.intentsMarket ?? null, error: state.marketError, isPending: false, retry: state.retryMarket }),
  useDataMeta: () => ({ data: state.metaError ? undefined : { revision: "1", intervals: ["15m", "1h", "1d"] }, error: state.metaError, refetch: state.retryMeta }),
  useMarketTicker: () => ({ ticker: { lastPrice: "2.00000000" }, live: true, status: "open" }),
}));
const tooltips = vi.hoisted(() => [] as { trigger: HTMLElement; content: unknown; destroyed: boolean }[]);
vi.mock("@luxalgo/vela/ui", () => ({
  Tooltip: class { record: { trigger: HTMLElement; content: unknown; destroyed: boolean }; constructor(trigger: HTMLElement, options: { content: unknown }) { this.record = { trigger, content: options.content, destroyed: false }; tooltips.push(this.record); } destroy() { this.record.destroyed = true; } },
}));

/** A Vela workspace double: its chart runs the real Terminal natives and renders the real topbar actions. */
class FakeWorkspace {
  static built: FakeWorkspace[] = [];
  static failNext = false;
  readonly root = document.createElement("div");
  readonly listeners = new Map<string, (payload: { bars: number }) => void>();
  readonly handles = new Map<string, IndicatorHandle & { setVisible: ReturnType<typeof vi.fn> }>();
  readonly emitted: NativeIndicatorOutput[] = [];
  readonly setTheme = vi.fn();
  readonly applyState = vi.fn();
  destroyed = false;
  logo = true;
  constructor(readonly host: HTMLElement, readonly options: VelaWorkspaceOptions) {
    if (FakeWorkspace.failNext) { FakeWorkspace.failNext = false; throw new Error("WebGL unavailable"); }
    host.appendChild(this.root);
    FakeWorkspace.built.push(this);
    this.refreshActions();
  }
  readonly chart = {
    on: (event: string, listener: (payload: { bars: number }) => void) => { this.listeners.set(event, listener); return () => this.listeners.delete(event); },
    addNativeIndicator: (type: string) => {
      const native = getNativeIndicator(type)!.create();
      native.start({ id: type, symbol: "Reference:NEAR/USD", timeframe: "15", live: true, bars: () => [], data: {} as never, emit: output => { this.emitted.push(output); }, pushData: () => {}, setStatus: () => {} }, {});
      const handle = { setVisible: vi.fn(), remove: () => native.stop() } as unknown as IndicatorHandle & { setVisible: ReturnType<typeof vi.fn> };
      this.handles.set(type, handle);
      return handle;
    },
  };
  getState() { return { version: 1, layout: "1", charts: [{ id: "c1", statuslineParts: { logo: this.logo } }] }; }
  refreshActions() {
    const ctx = { symbol: "Reference:NEAR/USD" } as WidgetContext;
    this.root.replaceChildren(...widgetActions("topbar", ctx).map(action => {
      const button = document.createElement("button");
      button.dataset.actionId = action.id;
      button.textContent = String(action.label);
      button.addEventListener("click", () => action.run(ctx));
      return button;
    }));
  }
  load(bars: number) { act(() => this.listeners.get("load:end")?.({ bars })); }
  destroy() { this.destroyed = true; for (const handle of this.handles.values()) handle.remove(); this.root.remove(); }
  /** The Terminal's lines as the chart last drew them: price, tag text, dash. */
  lines() {
    const output = this.emitted.at(-1);
    return (output?.lines ?? []).map(line => [line.y1, output?.labels?.find(label => label.id === `${line.id}-label`)?.text, line.style, line.extend]);
  }
}
vi.mock("@luxalgo/vela/workspace", () => ({ VelaWorkspace: function (host: HTMLElement, options: VelaWorkspaceOptions) { return new FakeWorkspace(host, options); } }));

// The Terminal owns Jev and hands the chart the plan to draw; tests set it through `state.plan`.
function NearChart(props: ComponentProps<typeof Chart>) { return <Chart entryPlan={state.plan as EntryPlan | undefined} {...props} />; }
const nearMarket: TestMarket = { id: "binance:NEARUSDC", venue: "binance", assetId: DEFAULT_PAIR.base.assetId, base: "NEAR", quote: "USDC", sourceLabel: "Binance", firstOpenTime: 0 };
const intentsMarket: TestMarket = { ...nearMarket, id: "intents:NEAR_USD", venue: "intents", sourceLabel: "NEAR Intents", quote: "USD" };
const storageKey = (assetId = DEFAULT_PAIR.base.assetId, source = "Binance", quote = "USDC") => `nervana:chart:v2:${encodeURIComponent(assetId)}:${source}:${quote}`;
const latest = () => FakeWorkspace.built.at(-1)!;
/** Vela loads after the first render; resolves once `count` charts were built. */
const built = (count = 1) => vi.waitFor(() => expect(FakeWorkspace.built).toHaveLength(count));

beforeEach(() => {
  window.localStorage.clear();
  FakeWorkspace.built = [];
  tooltips.length = 0;
  Object.assign(state, { market: nearMarket, intentsMarket: undefined, marketError: null, metaError: null, theme: "dark", plan: undefined });
  state.retryMeta.mockReset();
  state.retryMarket.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shows the loader until the reference chart paints bars, and names the market without its exchange", async () => {
  render(<NearChart />);
  await built();
  expect(screen.getByRole("status", { name: "Loading chart" })).toBeInTheDocument();
  const options = latest().options;
  expect(options).toMatchObject({ layout: false, symbol: "reference:NEAR/USD", timeframe: "15", timeframes: ["15", "60", "1D"], live: true, timezone: "Etc/UTC", watermark: false, persist: storageKey() });
  // The asset selector picks the market: no symbol search in the topbar.
  expect(options.topbar?.left).not.toContain("symbol");
  latest().load(500);
  expect(screen.queryByRole("status", { name: "Loading chart" })).toBeNull();
  expect(screen.getByRole("region", { name: "NEAR/USD reference chart. Last price 2 USD." })).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/Binance/);
});

it("prints prices at the market's price step as plain decimals", async () => {
  state.market = { ...nearMarket, id: "rhea:BLACKDRAGON_WNEAR", venue: "rhea", sourceLabel: "Rhea", quote: "USD" };
  render(<NearChart asset={{ ...DEFAULT_PAIR.base, price: "0.0000000120166" }} />);
  await built();
  const price = latest().options.formatters!.price!;
  const context = (surface: "statusLine" | "priceAxis", mode: "price" | "percent" = "price") => ({ surface, mode, decimals: 2, grouping: surface === "statusLine", locale: "en", timeZone: "UTC", fallback: () => "fallback" });
  expect(price(0.0000000120166, context("statusLine"))).toBe("0.000000012017");
  expect(price(-0.0000000001, context("priceAxis"))).toBe("-0.000000000100");
  expect(price(1.5, context("statusLine", "percent"))).toBe("fallback");
});

it("shows an error with Retry when a load ends without bars, and retries with a new chart", async () => {
  render(<NearChart />);
  await built();
  latest().load(0);
  expect(screen.getByRole("alert")).toHaveTextContent("Market data is unavailable.");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await built(2);
  expect(FakeWorkspace.built[0]!.destroyed).toBe(true);
  // The replaced chart's late load does not clear the new chart's loader.
  act(() => FakeWorkspace.built[0]!.listeners.get("load:end")?.({ bars: 500 }));
  expect(screen.getByRole("status", { name: "Loading chart" })).toBeInTheDocument();
  latest().load(500);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("reports a chart that cannot be created and retries it", async () => {
  FakeWorkspace.failNext = true;
  render(<NearChart />);
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("The chart failed to load.");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await built();
  latest().load(500);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("retries the market and chart settings from their own errors", async () => {
  state.market = undefined;
  state.marketError = new Error("down");
  const view = render(<NearChart />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(state.retryMarket).toHaveBeenCalledOnce();
  state.market = nearMarket;
  state.marketError = null;
  state.metaError = new Error("down");
  view.rerender(<NearChart />);
  expect(screen.getByRole("alert")).toHaveTextContent("Chart settings are unavailable.");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(state.retryMeta).toHaveBeenCalledOnce();
  expect(FakeWorkspace.built).toHaveLength(0);
});

it("says when an asset has no market to chart", async () => {
  state.market = null;
  render(<NearChart />);
  expect(screen.getByText("Chart unavailable for NEAR. No supported market yet.")).toBeInTheDocument();
  expect(FakeWorkspace.built).toHaveLength(0);
});

it("keeps saved charts per asset, source and quote", async () => {
  render(<NearChart />);
  await built();
  const { storage, persist } = latest().options;
  storage!.set(persist as string, JSON.stringify({ version: 1, charts: [{ id: "c1", drawings: { version: 1, drawings: [{ type: "trendline" }] } }] }));
  expect(JSON.parse(await storage!.get(storageKey()) as string).charts[0].drawings).toEqual(JSON.parse(localStorage.getItem(storageKey())!).charts[0].drawings);
  expect(JSON.parse(localStorage.getItem(storageKey())!).charts[0].drawings.drawings).toEqual([{ type: "trendline" }]);
  cleanup();
  state.market = { ...nearMarket, id: "coinbase:NEARUSD", sourceLabel: "Coinbase", quote: "USD" };
  render(<NearChart />);
  await built(2);
  expect(latest().options.persist).toBe(storageKey(DEFAULT_PAIR.base.assetId, "Coinbase", "USD"));
});

it("says when chart changes cannot be saved in this browser", async () => {
  render(<NearChart />);
  await built();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
  act(() => { void latest().options.storage!.set(latest().options.persist as string, "{}"); });
  expect(screen.getByText("Chart changes could not be saved in this browser.")).toHaveAttribute("role", "status");
});

it("hides the symbol logo once, so the title matches the chart before Vela", async () => {
  render(<NearChart />);
  await built();
  latest().load(500);
  expect(latest().applyState).toHaveBeenCalledWith(expect.objectContaining({ charts: [expect.objectContaining({ statuslineParts: { logo: false } })] }));
  latest().logo = false;
  latest().applyState.mockClear();
  latest().load(500);
  expect(latest().applyState).not.toHaveBeenCalled();
});

it("toggles the NEAR Intents overlay from the chart's topbar, off by default, and remembers the choice", async () => {
  state.intentsMarket = intentsMarket;
  render(<NearChart />);
  await built();
  latest().load(500);
  const overlay = latest().handles.get("near-intents")!;
  expect(overlay.setVisible).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole("button", { name: "Show Intents" })).toBeInTheDocument();
  expect(tooltips.at(-1)).toMatchObject({ content: "NEAR Intents swaps; some aren't indexed", destroyed: false });
  fireEvent.click(screen.getByRole("button", { name: "Show Intents" }));
  expect(overlay.setVisible).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole("button", { name: "Hide Intents" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Show Intents" })).toBeNull();
  expect(localStorage.getItem("nervana:intents-overlay:v1")).toBe("true");
  expect(screen.getByRole("region", { name: /with NEAR Intents swaps\./ })).toBeInTheDocument();
  // Toggling never rebuilds the chart.
  expect(FakeWorkspace.built).toHaveLength(1);
  cleanup();
  render(<NearChart />);
  await built(2);
  expect(latest().handles.get("near-intents")!.setVisible).toHaveBeenLastCalledWith(true);
});

it("shows the Intents button without an Intents market, recording the choice for when swaps are listed", async () => {
  render(<NearChart />);
  await built();
  latest().load(500);
  expect(latest().handles.has("near-intents")).toBe(false);
  expect(tooltips.at(-1)?.content).toBe("No NEAR Intents swaps for NEAR yet");
  fireEvent.click(screen.getByRole("button", { name: "Show Intents" }));
  expect(localStorage.getItem("nervana:intents-overlay:v1")).toBe("true");
});

it("draws open orders and Jev's levels as Terminal lines, never as saved drawings", async () => {
  state.plan = { levels: [{ price: 1.5, allocationPercent: 50, reactionProbability: 0.62 }, { price: 1.2, allocationPercent: 0, reactionProbability: 0.4 }], profile: "BUY" };
  const view = render(<NearChart orderLines={[{ id: "order-1", price: 1.8, side: "sell", text: "Sell limit · 2 NEAR · 1.8 USDC" }]} />);
  await built();
  expect(latest().lines()).toEqual([
    [1.8, "Sell limit · 2 NEAR · 1.8 USDC", "dashed", "both"],
    [1.5, "Entry 1 / 50% / p62", "solid", "both"],
    [1.2, "Watch 2 / p40", "solid", "both"],
  ]);
  state.plan = null;
  view.rerender(<NearChart orderLines={[]} />);
  expect(latest().lines()).toEqual([]);
});

it("rebuilds the chart in a new app theme, dropping theme colors saved under the old one and saved zoom and pan motion, loading deep history", async () => {
  const cards: Record<string, string> = { dark: "#111312", light: "#ffffff" };
  vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ getPropertyValue: (name: string) => name === "--card" ? cards[state.theme]! : "" }) as CSSStyleDeclaration);
  const view = render(<NearChart />);
  await built();
  const { storage, persist, animations, bars } = latest().options;
  expect(animations).toEqual({ zoom: false, pan: false, scroll: false, autoscale: false });
  expect(bars).toBe(5000);
  const config = { layout: { background: "#111312", textColor: "#9fafa9", fontSize: 13 }, candles: { upColor: "#34d399", downColor: "#fb7185" }, line: { color: "#3b82f6" }, priceScale: { borderColor: "#1a1c1b", log: true }, animations: { zoom: true, pan: true, autoscale: true, intro: true } };
  const saved = JSON.stringify({ version: 1, charts: [{ id: "c1", rendererConfig: config, drawings: { drawings: [{ type: "text" }] } }] });
  storage!.set(persist as string, saved);
  const sameTheme = JSON.parse(await storage!.get(persist as string) as string);
  expect(sameTheme.charts[0].rendererConfig).toEqual({ ...config, animations: { intro: true } });
  // Vela restores a saved chart without the workspace's depth: one saved without its own loads deep.
  expect(sameTheme.charts[0].bars).toBe(5000);
  storage!.set(persist as string, JSON.stringify({ version: 1, charts: [{ id: "c1", bars: 1000 }] }));
  expect(JSON.parse(await storage!.get(persist as string) as string).charts[0].bars).toBe(1000);
  storage!.set(persist as string, saved);
  state.theme = "light";
  view.rerender(<NearChart />);
  await built(2);
  expect(FakeWorkspace.built[0]!.destroyed).toBe(true);
  const restored = JSON.parse(await latest().options.storage!.get(persist as string) as string);
  expect(restored.charts[0].rendererConfig).toEqual({ layout: { fontSize: 13 }, candles: {}, line: { color: "#3b82f6" }, priceScale: { log: true }, animations: { intro: true } });
  expect(restored.charts[0].drawings).toEqual({ drawings: [{ type: "text" }] });
});
