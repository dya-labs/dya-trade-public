/**
 * The chart's lifecycle: each build of the Vela workspace is numbered; only that build's load
 * results move the state, so a callback from a replaced chart is refused. A failed chart shows its
 * error until Retry starts the next attempt or a later load of the same chart paints bars.
 */
export type ChartState =
  | { phase: "building"; attempt: number; build: number | null }
  | { phase: "ready"; attempt: number; build: number }
  | { phase: "failed"; attempt: number; build: number; message: string };

export type ChartEvent =
  /** A workspace was created for this attempt (or rebuilt for new settings, theme or revision). */
  | { type: "build"; build: number }
  /** The build's chart painted bars. */
  | { type: "loaded"; build: number }
  /** The build failed: its chart could not be created, or a load ended without bars. */
  | { type: "failed"; build: number; message: string }
  | { type: "retry" };

export const INITIAL_CHART_STATE: ChartState = { phase: "building", attempt: 0, build: null };

export function nextChart(state: ChartState, event: ChartEvent): ChartState | undefined {
  switch (event.type) {
    case "build":
      return { phase: "building", attempt: state.attempt, build: event.build };
    case "loaded":
      // A later load of the same chart clears its error: Vela falls back on its own from a timeframe the data API refuses.
      return state.build === event.build ? { phase: "ready", attempt: state.attempt, build: event.build } : undefined;
    case "failed":
      return state.phase !== "failed" && state.build === event.build ? { phase: "failed", attempt: state.attempt, build: event.build, message: event.message } : undefined;
    case "retry":
      return state.phase === "failed" ? { phase: "building", attempt: state.attempt + 1, build: null } : undefined;
  }
}

/** What the chart area shows: a loader, the error with its Retry, or the chart. */
export function chartView(state: ChartState, data: { market: "loading" | "listed" | "unlisted" | "failed"; settings: "loading" | "ready" | "failed" }):
  | { kind: "unlisted" }
  | { kind: "loading" }
  | { kind: "error"; message: string; retry: "chart" | "market" | "settings" }
  | { kind: "chart" } {
  if (data.market === "unlisted") return { kind: "unlisted" };
  if (data.market === "failed") return { kind: "error", message: "Market data is unavailable.", retry: "market" };
  if (data.settings === "failed") return { kind: "error", message: "Chart settings are unavailable.", retry: "settings" };
  if (state.phase === "failed") return { kind: "error", message: state.message, retry: "chart" };
  return data.market === "listed" && data.settings === "ready" && state.phase === "ready" ? { kind: "chart" } : { kind: "loading" };
}
