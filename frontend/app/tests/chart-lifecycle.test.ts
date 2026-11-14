import { expect, it } from "vitest";
import { chartView, INITIAL_CHART_STATE, nextChart, type ChartEvent, type ChartState } from "@/components/near/chart-lifecycle";

function run(events: ChartEvent[], from: ChartState = INITIAL_CHART_STATE) {
  return events.reduce<ChartState>((state, event) => nextChart(state, event) ?? state, from);
}
const listed = { market: "listed", settings: "ready" } as const;

it("shows the chart once its build paints bars", () => {
  const building = run([{ type: "build", build: 1 }]);
  expect(chartView(building, listed)).toEqual({ kind: "loading" });
  expect(chartView(run([{ type: "loaded", build: 1 }], building), listed)).toEqual({ kind: "chart" });
});

it("refuses load results of a replaced build", () => {
  const rebuilt = run([{ type: "build", build: 1 }, { type: "build", build: 2 }]);
  expect(nextChart(rebuilt, { type: "loaded", build: 1 })).toBeUndefined();
  expect(nextChart(rebuilt, { type: "failed", build: 1, message: "Market data is unavailable." })).toBeUndefined();
  expect(nextChart(INITIAL_CHART_STATE, { type: "loaded", build: 1 })).toBeUndefined();
});

it("keeps a failed chart's error until Retry or a later load of the same chart", () => {
  const failed = run([{ type: "build", build: 1 }, { type: "loaded", build: 1 }, { type: "failed", build: 1, message: "Market data is unavailable." }]);
  expect(chartView(failed, listed)).toEqual({ kind: "error", message: "Market data is unavailable.", retry: "chart" });
  expect(nextChart(failed, { type: "failed", build: 1, message: "again" })).toBeUndefined();
  // Vela's own fallback from a refused timeframe paints bars on the same chart.
  expect(chartView(run([{ type: "loaded", build: 1 }], failed), listed)).toEqual({ kind: "chart" });
  const retrying = run([{ type: "retry" }], failed);
  expect(retrying).toEqual({ phase: "building", attempt: 1, build: null });
  expect(nextChart(retrying, { type: "retry" })).toBeUndefined();
  expect(run([{ type: "build", build: 2 }, { type: "loaded", build: 2 }], retrying)).toEqual({ phase: "ready", attempt: 1, build: 2 });
});

it("only retries a failed chart", () => {
  expect(nextChart(INITIAL_CHART_STATE, { type: "retry" })).toBeUndefined();
  expect(nextChart(run([{ type: "build", build: 1 }, { type: "loaded", build: 1 }]), { type: "retry" })).toBeUndefined();
});

it("reports missing markets and settings before the chart's own state", () => {
  const ready = run([{ type: "build", build: 1 }, { type: "loaded", build: 1 }]);
  const rows: [Parameters<typeof chartView>[1], ReturnType<typeof chartView>][] = [
    [{ market: "unlisted", settings: "failed" }, { kind: "unlisted" }],
    [{ market: "failed", settings: "ready" }, { kind: "error", message: "Market data is unavailable.", retry: "market" }],
    [{ market: "listed", settings: "failed" }, { kind: "error", message: "Chart settings are unavailable.", retry: "settings" }],
    [{ market: "loading", settings: "ready" }, { kind: "loading" }],
    [{ market: "listed", settings: "loading" }, { kind: "loading" }],
    [listed, { kind: "chart" }],
  ];
  for (const [data, view] of rows) expect(chartView(ready, data)).toEqual(view);
});
