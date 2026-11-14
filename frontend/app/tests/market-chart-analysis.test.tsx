import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChartAnalysis } from "@/components/near/use-chart-analysis";
import { analyzeEntry } from "@/lib/near/http/market-client";
import { AUTO_ENTRY_ANALYSIS_KEY } from "@/lib/analysis/auto-analysis";
import { analysisStorage } from "@/lib/analysis/market-storage";
import { entryPlan } from "./fixtures/entry-plan";
import { ENTRY_ANALYSIS_HISTORY_KEY } from "@/lib/analysis/entry-analysis-history";

vi.mock("@/lib/near/http/market-client", () => ({ analyzeEntry: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); vi.clearAllMocks(); });
describe("per-token chart analysis", () => {
  it("ignores old automatic settings and does not analyze on token selection", async () => {
    analysisStorage(localStorage, "btc").setItem(AUTO_ENTRY_ANALYSIS_KEY, "true");
    const hook = renderHook(({ asset }) => useChartAnalysis(asset), { initialProps: { asset: "btc" } });
    hook.rerender({ asset: "sol" });
    expect(analyzeEntry).not.toHaveBeenCalled();
    expect(hook.result.current.entryPlan).toBeNull();
  });
  it("keeps analysis usable when browser storage reads and writes are denied", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Denied"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Denied"); });
    const hook = renderHook(() => useChartAnalysis("btc"));
    expect(hook.result.current.entryPlan).toBeNull();
    await waitFor(() => expect(hook.result.current.analysisMessage).toMatch(/could not be loaded/));
    const plan = { market: { assetId: "btc" }, profile: "WAIT", asOf: 1 } as Awaited<ReturnType<typeof analyzeEntry>>;
    vi.mocked(analyzeEntry).mockResolvedValueOnce(plan);
    await act(async () => { await hook.result.current.drawEntryLevels(); });
    expect(hook.result.current.entryPlan).toBe(plan);
    expect(hook.result.current.analysisMessage).toMatch(/could not be saved/);
    expect(hook.result.current.analyzing).toBe(false);
  });

  it("retains an unsaved current result across the periodic refresh until it expires", async () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota"); });
    const hook = renderHook(() => useChartAnalysis("btc"));
    const plan = { market: { assetId: "btc" }, profile: "WAIT", asOf: 1, expiresAt: Date.now() + 90_000 } as Awaited<ReturnType<typeof analyzeEntry>>;
    vi.mocked(analyzeEntry).mockResolvedValueOnce(plan);
    await act(async () => { await hook.result.current.drawEntryLevels(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(hook.result.current.entryPlan).toBe(plan);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(hook.result.current.entryPlan).toBeNull();
  });

  it("aborts a departing market and ignores late analysis results", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof analyzeEntry>>) => void;
    vi.mocked(analyzeEntry).mockImplementation(() => new Promise(done => { resolve = done; }));
    const hook = renderHook(() => useChartAnalysis("btc"));
    let request!: Promise<void>;
    act(() => { request = hook.result.current.drawEntryLevels(); });
    const signal = vi.mocked(analyzeEntry).mock.calls[0][1]!;
    hook.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve({ market: { assetId: "btc" } } as Awaited<ReturnType<typeof analyzeEntry>>);
      await request;
    });
    expect(analysisStorage(localStorage, "btc").getItem(ENTRY_ANALYSIS_HISTORY_KEY)).toBeNull();
  });

  it("lets a newly selected market analyze before an aborted old request settles", async () => {
    let oldResolve!: (value: Awaited<ReturnType<typeof analyzeEntry>>) => void;
    let newResolve!: (value: Awaited<ReturnType<typeof analyzeEntry>>) => void;
    vi.mocked(analyzeEntry).mockReset().mockImplementationOnce(() => new Promise(resolve => { oldResolve = resolve; })).mockImplementationOnce(() => new Promise(resolve => { newResolve = resolve; }));
    const hook = renderHook(({ asset }) => useChartAnalysis(asset), { initialProps: { asset: "btc" } });
    let oldRequest!: Promise<void>, newRequest!: Promise<void>;
    act(() => { oldRequest = hook.result.current.drawEntryLevels(); });
    const oldSignal = vi.mocked(analyzeEntry).mock.calls[0][1]!;
    hook.rerender({ asset: "sol" });
    expect(oldSignal.aborted).toBe(true);
    expect(hook.result.current.analyzing).toBe(false);
    act(() => { newRequest = hook.result.current.drawEntryLevels(); });
    expect(analyzeEntry).toHaveBeenCalledTimes(2);
    expect(hook.result.current.analyzing).toBe(true);
    await act(async () => { oldResolve({ market: { assetId: "btc" } } as Awaited<ReturnType<typeof analyzeEntry>>); await oldRequest; });
    expect(hook.result.current.analyzing).toBe(true);
    expect(hook.result.current.entryPlan).toBeNull();
    const plan = { ...entryPlan(Date.now()), symbol: "SOLUSDC", market: { assetId: "sol", source: "Binance" as const, symbol: "SOL", quote: "USDC" as const }, expiresAt: Date.now() + 60_000 };
    await act(async () => { newResolve(plan); await newRequest; });
    expect(hook.result.current.entryPlan).toEqual(plan);
    expect(hook.result.current.analyzing).toBe(false);
    expect(analysisStorage(localStorage, "btc").getItem(ENTRY_ANALYSIS_HISTORY_KEY)).toBeNull();
  });

  it("does not carry a failed market's message to a different selected token", async () => {
    vi.mocked(analyzeEntry).mockReset().mockRejectedValueOnce(new Error("BTC synthetic provider error"));
    const hook = renderHook(({ asset }) => useChartAnalysis(asset), { initialProps: { asset: "btc" } });
    await act(async () => { await hook.result.current.drawEntryLevels(); });
    expect(hook.result.current.analysisMessage).toBe("BTC synthetic provider error");
    hook.rerender({ asset: "sol" });
    expect(hook.result.current.analysisMessage).toBe("");
  });

  it("hides a prior market's plan even if the new market's storage read fails", async () => {
    const plan = { ...entryPlan(Date.now()), symbol: "BTCUSDC", market: { assetId: "btc", source: "Binance" as const, symbol: "BTC", quote: "USDC" as const }, expiresAt: Date.now() + 60_000 };
    vi.mocked(analyzeEntry).mockReset().mockResolvedValueOnce(plan);
    const hook = renderHook(({ asset }) => useChartAnalysis(asset), { initialProps: { asset: "btc" } });
    await act(async () => { await hook.result.current.drawEntryLevels(); });
    expect(hook.result.current.entryPlan).toEqual(plan);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Synthetic denied storage"); });
    hook.rerender({ asset: "sol" });
    expect(hook.result.current.entryPlan).toBeNull();
    expect(hook.result.current.analysisMessage).toMatch(/could not be loaded/);
  });
});
