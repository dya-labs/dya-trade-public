import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMarketQuote } from "@/components/near/use-market-quote";
import type { MarketPreview } from "@/lib/near/http/schemas/trading";
const preview = vi.fn();
vi.mock("@/lib/near/http/trading-client", () => ({ previewMarketOrder: (...args: unknown[]) => preview(...args) }));
afterEach(() => { vi.useRealTimers(); preview.mockReset(); });
it("ignores a late quote from the previous asset selection", async () => {
  vi.useFakeTimers();
  let finishOld!: (value: Partial<MarketPreview>) => void;
  preview.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue({ principal: "22", shortfall: "0" });
  const base = { side: "buy" as const, quantity: "1", sizePercent: 0, isSliding: false, quoteDelay: 0, onAffordableSize: vi.fn(), quoteAssetId: "usdc" };
  const { result, rerender } = renderHook(({ token }) => useMarketQuote({ ...base, quoteKey: token, baseAssetId: token }), { initialProps: { token: "SOL" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const oldSignal = preview.mock.calls[0][1] as AbortSignal;
  rerender({ token: "ETH" });
  expect(oldSignal.aborted).toBe(true);
  expect(result.current.currentQuote).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(result.current.currentQuote?.principal).toBe("22");
  await act(async () => { finishOld({ principal: "99", shortfall: "0" }); });
  expect(result.current.currentQuote?.principal).toBe("22");
  expect(preview.mock.calls[2][0]).toMatchObject({ baseAssetId: "ETH", quoteAssetId: "usdc" });
});
