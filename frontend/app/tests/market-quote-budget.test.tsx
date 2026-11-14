import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MARKET_QUOTE_DEBOUNCE_MS, useMarketQuote } from "@/components/near/use-market-quote";
import { previewMarketOrder } from "@/lib/near/http/trading-client";

vi.mock("@/lib/near/http/trading-client", () => ({ previewMarketOrder: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

const preview = (principal: string) => ({ principal, shortfall: "0" }) as Awaited<ReturnType<typeof previewMarketOrder>>;
const base = { baseAssetId: "sol", quoteAssetId: "usdc", decimals: 9, quoteKey: "sol:1", side: "buy" as const, quantity: "1", sizePercent: 50, available: "100", isSliding: false, quoteDelay: 0 };
// Runs the quick quote and the full-window one, requested together once the debounce ends.
async function flushQuote() { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); }

it("withdraws an old quote immediately when the available balance decreases", async () => {
  vi.useFakeTimers();
  vi.mocked(previewMarketOrder).mockResolvedValue(preview("20"));
  const onAffordableSize = vi.fn();
  const hook = renderHook(({ available }) => useMarketQuote({ ...base, available, onAffordableSize }), { initialProps: { available: "100" } });
  await flushQuote();
  expect(hook.result.current.currentQuote?.principal).toBe("20");
  hook.rerender({ available: "10" });
  expect(hook.result.current.currentQuote).toBeNull();
  await flushQuote();
  expect(onAffordableSize).toHaveBeenCalledWith("0.24975");
  expect(hook.result.current.currentQuote).toBeNull();
});

it("revalidates a smaller percentage budget even when the token quantity has not changed", async () => {
  vi.useFakeTimers();
  vi.mocked(previewMarketOrder).mockResolvedValue(preview("40"));
  const onAffordableSize = vi.fn();
  const hook = renderHook(({ sizePercent }) => useMarketQuote({ ...base, sizePercent, onAffordableSize }), { initialProps: { sizePercent: 50 } });
  await flushQuote();
  expect(hook.result.current.currentQuote?.principal).toBe("40");
  hook.rerender({ sizePercent: 25 });
  expect(hook.result.current.currentQuote).toBeNull();
  await flushQuote();
  expect(onAffordableSize).toHaveBeenCalledWith("0.624375");
});

it("does not carry a previous balance's quote failure into a fresh balance context", async () => {
  vi.useFakeTimers();
  // The quick quote and the full-window one both fail before the error shows.
  vi.mocked(previewMarketOrder).mockRejectedValueOnce(new Error("Old balance quote failed")).mockRejectedValueOnce(new Error("Old balance quote failed")).mockResolvedValue(preview("20"));
  const onAffordableSize = vi.fn();
  const hook = renderHook(({ available }) => useMarketQuote({ ...base, available, onAffordableSize }), { initialProps: { available: "100" } });
  await flushQuote();
  expect(hook.result.current.currentQuoteError).toBe("Old balance quote failed");
  hook.rerender({ available: "200" });
  expect(hook.result.current.currentQuoteError).toBe("");
  await flushQuote();
  expect(hook.result.current.currentQuote?.principal).toBe("20");
});

it("ignores a late failed request after balance revalidation has produced a fresh quote", async () => {
  vi.useFakeTimers();
  let rejectOld!: (error: Error) => void;
  vi.mocked(previewMarketOrder).mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; })).mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(preview("20"));
  const onAffordableSize = vi.fn();
  const hook = renderHook(({ available }) => useMarketQuote({ ...base, available, onAffordableSize }), { initialProps: { available: "100" } });
  await flushQuote();
  const oldSignal = vi.mocked(previewMarketOrder).mock.calls[0][1]!;
  hook.rerender({ available: "200" });
  expect(oldSignal.aborted).toBe(true);
  await flushQuote();
  await act(async () => { rejectOld(new Error("Late old request")); });
  expect(hook.result.current.currentQuote?.principal).toBe("20");
  expect(hook.result.current.currentQuoteError).toBe("");
});

it.each(["buy", "sell"] as const)("checks the percentage budget only for %s sizing", async side => {
  vi.mocked(previewMarketOrder).mockResolvedValue({ principal: "50", shortfall: "0" } as Awaited<ReturnType<typeof previewMarketOrder>>);
  const onAffordableSize = vi.fn();
  const hook = renderHook(() => useMarketQuote({
    baseAssetId: "sol", quoteAssetId: "usdc", decimals: 9, quoteKey: "sol:1",
    side, quantity: "1", sizePercent: 25, available: "100", isSliding: false,
    quoteDelay: 0, onAffordableSize,
  }));
  await waitFor(() => {
    if (side === "buy") expect(onAffordableSize).toHaveBeenCalledWith("0.4995");
    else expect(hook.result.current.currentQuote?.principal).toBe("50");
  });
  if (side === "sell") expect(onAffordableSize).not.toHaveBeenCalled();
});

it("invalidates the old quote and sends the changed slippage", async () => {
  vi.useFakeTimers();
  vi.mocked(previewMarketOrder).mockResolvedValue(preview("20"));
  const onAffordableSize = vi.fn();
  const h = renderHook(({ bps }) => useMarketQuote({ ...base, slippage: { mode: "custom", bps }, onAffordableSize }), { initialProps: { bps: 30 } });
  await flushQuote();
  expect(h.result.current.currentQuote).not.toBeNull();
  h.rerender({ bps: 20 });
  expect(h.result.current.currentQuote).toBeNull();
  await flushQuote();
  expect(previewMarketOrder).toHaveBeenLastCalledWith(expect.objectContaining({ slippage: { mode: "custom", bps: 20 } }), expect.any(AbortSignal), false);
});

 it("preserves exact-spend buy input without affordable-output resizing and invalidates on budget changes", async () => {
  vi.useFakeTimers();
  vi.mocked(previewMarketOrder).mockResolvedValue(preview("10"));
  const onAffordableSize = vi.fn();
  const h = renderHook(({ quoteAmount }) => useMarketQuote({ ...base, quoteAmount, onAffordableSize }), { initialProps: { quoteAmount: "10" } });
  await flushQuote();
  expect(previewMarketOrder).toHaveBeenLastCalledWith(expect.objectContaining({ quoteAmount: "10" }), expect.any(AbortSignal), false);
  expect(onAffordableSize).not.toHaveBeenCalled();
  h.rerender({ quoteAmount: "11" });
  expect(h.result.current.currentQuote).toBeNull();
  await flushQuote();
  expect(previewMarketOrder).toHaveBeenLastCalledWith(expect.objectContaining({ quoteAmount: "11" }), expect.any(AbortSignal), false);
 });

it("starts a typed preview after the shorter debounce and cancels superseded work", async () => {
  vi.useFakeTimers();
  vi.mocked(previewMarketOrder).mockResolvedValue(preview("20"));
  const onAffordableSize = vi.fn();
  const hook = renderHook(({ quantity }) => useMarketQuote({ ...base, quantity, quoteDelay: MARKET_QUOTE_DEBOUNCE_MS, onAffordableSize }), { initialProps: { quantity: "1" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(299); });
  expect(previewMarketOrder).not.toHaveBeenCalled();
  hook.rerender({ quantity: "2" });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  // Only the settled input is quoted: its quick quote and its full-window one.
  expect(vi.mocked(previewMarketOrder).mock.calls.map(call => [call[0].quantity, call[2]])).toEqual([["2", true], ["2", false]]);
});

it("pauses background previews during Review and resumes after cancellation", async () => {
  vi.useFakeTimers();
  vi.mocked(previewMarketOrder).mockImplementationOnce(() => new Promise(() => {})).mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(preview("20"));
  const onAffordableSize = vi.fn();
  const hook = renderHook(({ suspended }) => useMarketQuote({ ...base, suspended, onAffordableSize }), { initialProps: { suspended: false } });
  await flushQuote();
  const oldSignal = vi.mocked(previewMarketOrder).mock.calls[0][1]!;
  hook.rerender({ suspended: true });
  expect(oldSignal.aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(previewMarketOrder).toHaveBeenCalledTimes(2);
  hook.rerender({ suspended: false });
  await flushQuote();
  // A quick quote and a full-window one for the resumed input.
  expect(previewMarketOrder).toHaveBeenCalledTimes(4);
  expect(hook.result.current.currentQuote?.principal).toBe("20");
});

it("shows a quick quote first, replaces it with the full-window one requested alongside, and keeps it if that one fails", async () => {
  vi.useFakeTimers();
  let full!: (value: Awaited<ReturnType<typeof previewMarketOrder>>) => void;
  vi.mocked(previewMarketOrder).mockResolvedValueOnce(preview("20"))
    .mockImplementationOnce(() => new Promise(resolve => { full = resolve; }))
    .mockResolvedValueOnce(preview("30")).mockRejectedValueOnce(new Error("No liquidity"));
  const onAffordableSize = vi.fn();
  const hook = renderHook(({ quantity }) => useMarketQuote({ ...base, quantity, sizePercent: 0, onAffordableSize }), { initialProps: { quantity: "1" } });
  await flushQuote();
  expect(vi.mocked(previewMarketOrder).mock.calls.map(call => call[2])).toEqual([true, false]);
  expect(hook.result.current.currentQuote?.principal).toBe("20");
  await act(async () => { full(preview("19.9")); });
  expect(hook.result.current.currentQuote?.principal).toBe("19.9");
  // The next input's full-window quote fails: its quick quote stays usable, with no error.
  hook.rerender({ quantity: "2" });
  await flushQuote();
  expect(vi.mocked(previewMarketOrder).mock.calls.map(call => call[2])).toEqual([true, false, true, false]);
  expect(hook.result.current.currentQuote?.principal).toBe("30");
  expect(hook.result.current.currentQuoteError).toBe("");
  // Review reuses a stored quote by reference: one per input, shared by both of its quotes.
  const references = vi.mocked(previewMarketOrder).mock.calls.map(call => call[0].quoteReference);
  expect(references[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(references).toEqual([references[0], references[0], references[2], references[2]]);
  expect(references[2]).not.toBe(references[0]);
});

it("keeps the full-window quote when the quick one arrives after it, and holds a full-window failure back until the quick one settles", async () => {
  vi.useFakeTimers();
  let quick!: (value: Awaited<ReturnType<typeof previewMarketOrder>>) => void, failFull!: (error: Error) => void, failQuick!: (error: Error) => void;
  vi.mocked(previewMarketOrder)
    .mockImplementationOnce(() => new Promise(resolve => { quick = resolve; })).mockResolvedValueOnce(preview("19.9"))
    .mockImplementationOnce(() => new Promise(resolve => { quick = resolve; })).mockImplementationOnce(() => new Promise((_, reject) => { failFull = reject; }))
    .mockImplementationOnce(() => new Promise((_, reject) => { failQuick = reject; })).mockRejectedValueOnce(new Error("No liquidity"));
  const onAffordableSize = vi.fn();
  const hook = renderHook(({ quantity }) => useMarketQuote({ ...base, quantity, sizePercent: 0, onAffordableSize }), { initialProps: { quantity: "1" } });
  await flushQuote();
  await act(async () => { quick(preview("20")); });
  expect(hook.result.current.currentQuote?.principal).toBe("19.9");
  // The full-window quote fails first: no error while the quick one may still arrive, which then shows.
  hook.rerender({ quantity: "2" });
  await flushQuote();
  await act(async () => { failFull(new Error("No liquidity")); });
  expect(hook.result.current.currentQuoteError).toBe("");
  await act(async () => { quick(preview("30")); });
  expect(hook.result.current.currentQuote?.principal).toBe("30");
  expect(hook.result.current.currentQuoteError).toBe("");
  // Both fail: the full-window failure shows once the quick quote has failed too.
  hook.rerender({ quantity: "3" });
  await flushQuote();
  expect(hook.result.current.currentQuoteError).toBe("");
  await act(async () => { failQuick(new Error("Quick miss")); });
  expect(hook.result.current.currentQuoteError).toBe("No liquidity");
});
