import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useMarketTrades } from "@/components/near/use-activity";
import { getMarketTrades, getMarketTradeStatus } from "@/lib/near/http/trading-client";
import { fixtures, setTradesState } from "@/stories/trades/api-mocks";
import type { Trade } from "@/lib/near/http/schemas/trading";
vi.mock("@/lib/near/http/trading-client", () => ({ getOrders: vi.fn(), getOrderStatus: vi.fn(), getMarketTrades: vi.fn(), getMarketTradeStatus: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const balanceKey = ["near", "account", "wallet", "balances", "confidential", "all"];
function trade(): Trade { setTradesState("Processing");return fixtures()[0]; }
function setup(active = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const read = vi.fn(async () => ({ amount: "9" }));client.setQueryData(balanceKey, { amount: "10" });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(() => ({ history: useMarketTrades("wallet"), balance: useQuery({ queryKey: balanceKey, queryFn: read, enabled: active, staleTime: Infinity }) }), { wrapper });
  return { client, read, view, close() { view.unmount();client.clear(); } };
}
it.each(["settled", "failed"] as const)("invalidates balances when history status changes to %s without a mounted ticket", async state => {
  const before = trade();vi.mocked(getMarketTrades).mockResolvedValue({ trades: [before] });vi.mocked(getMarketTradeStatus).mockResolvedValue({ trade: { ...before, state } });
  const t = setup();try { await waitFor(() => expect(t.view.result.current.history.data?.[0].state).toBe(state));expect(t.client.getQueryState(balanceKey)?.isInvalidated).toBe(true); } finally { t.close(); }
});
it.each(["settled", "failed"] as const)("invalidates balances when the history list already reports %s", async state => {
  let current = trade();vi.mocked(getMarketTrades).mockImplementation(async () => ({ trades: [structuredClone(current)] }));vi.mocked(getMarketTradeStatus).mockImplementation(async () => ({ trade: structuredClone(current) }));
  const t = setup();try {
    await waitFor(() => expect(t.view.result.current.history.data?.[0].state).toBe("submitted"));expect(t.client.getQueryState(balanceKey)?.isInvalidated).toBe(false);
    current = { ...current, state, nearTxHashes: [] };await act(async () => { await t.view.result.current.history.refetch(); });
    expect(t.client.getQueryState(balanceKey)?.isInvalidated).toBe(true);
  } finally { t.close(); }
});
it("does not repeatedly invalidate balances for unchanged terminal history", async () => {
  // A settled trade with its execution amounts recorded needs no further status checks.
  const item: Trade = { ...trade(), state: "settled", nearTxHashes: [], execution: { inputRaw: "8000000", outputRaw: "2000000000000000000000000", inputAmount: "8", outputAmount: "2", settledAt: 1000 } };vi.mocked(getMarketTrades).mockResolvedValue({ trades: [item] });
  const t = setup();try { await waitFor(() => expect(t.view.result.current.history.isSuccess).toBe(true));await act(async () => { await t.view.result.current.history.refetch(); });expect(t.client.getQueryState(balanceKey)?.isInvalidated).toBe(false);expect(getMarketTradeStatus).not.toHaveBeenCalled(); } finally { t.close(); }
});
it("retains unresolved history on status failure without implying a balance-changing outcome", async () => {
  vi.mocked(getMarketTrades).mockResolvedValue({ trades: [trade()] });vi.mocked(getMarketTradeStatus).mockRejectedValue(new Error("Synthetic status outage"));
  const t = setup();try { await waitFor(() => expect(t.view.result.current.history.data?.[0].syncError).toBe(true));expect(t.view.result.current.history.data?.[0].state).toBe("submitted");expect(t.client.getQueryState(balanceKey)?.isInvalidated).toBe(false); } finally { t.close(); }
});
it("refetches an active balance observer when history observes settlement", async () => {
  const before = trade();vi.mocked(getMarketTrades).mockResolvedValue({ trades: [before] });vi.mocked(getMarketTradeStatus).mockResolvedValue({ trade: { ...before, state: "settled" } });
  const t = setup(true);try { await waitFor(() => expect(t.view.result.current.balance.data?.amount).toBe("9"));expect(t.read).toHaveBeenCalledTimes(1); } finally { t.close(); }
});
it("refreshes balances when a newly listed trade is already settled", async () => {
  let items: Trade[] = [];vi.mocked(getMarketTrades).mockImplementation(async () => ({ trades: structuredClone(items) }));
  const t = setup();try { await waitFor(() => expect(t.view.result.current.history.isSuccess).toBe(true));items = [{ ...trade(), state: "settled", nearTxHashes: [] }];await act(async () => { await t.view.result.current.history.refetch(); });expect(t.client.getQueryState(balanceKey)?.isInvalidated).toBe(true); } finally { t.close(); }
});
it("refreshes balances for a confirmed list outcome even when its hash backfill fails", async () => {
  let current = trade();vi.mocked(getMarketTrades).mockImplementation(async () => ({ trades: [structuredClone(current)] }));vi.mocked(getMarketTradeStatus).mockImplementation(async () => ({ trade: structuredClone(current) }));
  const t = setup();try {
    await waitFor(() => expect(t.view.result.current.history.data?.[0].state).toBe("submitted"));
    current = { ...current, state: "settled" };vi.mocked(getMarketTradeStatus).mockRejectedValue(new Error("Synthetic hash backfill outage"));await act(async () => { await t.view.result.current.history.refetch(); });
    await waitFor(() => expect(t.view.result.current.history.data?.[0]).toMatchObject({ state: "settled", syncError: true }));expect(t.client.getQueryState(balanceKey)?.isInvalidated).toBe(true);
  } finally { t.close(); }
});
