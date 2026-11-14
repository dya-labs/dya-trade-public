import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useChartAnalysis } from "@/components/near/use-chart-analysis";
import { analyzeEntry } from "@/lib/near/http/market-client";
import { analysisStorage } from "@/lib/analysis/market-storage";
import { AUTO_ENTRY_ANALYSIS_KEY } from "@/lib/analysis/auto-analysis";
import { readEntryAnalysisHistory } from "@/lib/analysis/entry-analysis-history";
import { entryPlan } from "./fixtures/entry-plan";
vi.mock("@/lib/near/http/market-client", () => ({ analyzeEntry: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); localStorage.clear(); });
const assetId = "nep141:wrap.near";
const stored = () => analysisStorage(localStorage, assetId);
const plan = () => ({ ...entryPlan(Date.now()), market: { assetId, source: "Binance" as const, symbol: "NEAR", quote: "USDC" as const } });
it("never schedules an analysis even when a saved Auto preference is enabled", async () => {
  vi.useFakeTimers(); stored().setItem(AUTO_ENTRY_ANALYSIS_KEY, "true");
  renderHook(() => useChartAnalysis(assetId));
  await act(async () => { await vi.advanceTimersByTimeAsync(24 * 60 * 60_000); });
  expect(analyzeEntry).not.toHaveBeenCalled();
  expect(readEntryAnalysisHistory(stored())).toEqual([]);
});
it("records requested analysis as manual and does not repeat it at later candle boundaries", async () => {
  vi.useFakeTimers(); vi.mocked(analyzeEntry).mockImplementation(async () => plan());
  const hook = renderHook(() => useChartAnalysis(assetId));
  await act(async () => { await hook.result.current.drawEntryLevels(); });
  expect(readEntryAnalysisHistory(stored())).toMatchObject([{ trigger: "manual" }]);
  await act(async () => { await vi.advanceTimersByTimeAsync(8 * 60 * 60_000); });
  expect(analyzeEntry).toHaveBeenCalledTimes(1);
});
it("requires another manual request after a provider failure", async () => {
  vi.useFakeTimers(); vi.mocked(analyzeEntry).mockRejectedValueOnce(new Error("Provider unavailable")).mockImplementation(async () => plan());
  const hook = renderHook(() => useChartAnalysis(assetId));
  await act(async () => { await hook.result.current.drawEntryLevels(); });
  expect(hook.result.current.analysisMessage).toBe("Provider unavailable");
  await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60 * 60_000); });
  expect(analyzeEntry).toHaveBeenCalledTimes(1);
  await act(async () => { await hook.result.current.drawEntryLevels(); });
  expect(analyzeEntry).toHaveBeenCalledTimes(2);
});
