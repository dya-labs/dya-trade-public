import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useOrders, useMarketTrades } from "@/components/near/use-activity";
import { useTerminalData } from "@/components/near/use-terminal-data";
import { useBalanceQuery } from "@dya/wallet-ui/hooks/use-live-balances";
import { getOrders, getMarketTrades, getOrderStatus, getMarketTradeStatus } from "@/lib/near/http/trading-client";
import { getSession, getAllBalances } from "@dya/wallet-ui/lib/near/http/account-client";
vi.mock("@/lib/near/http/trading-client", () => ({ getOrders: vi.fn(), getMarketTrades: vi.fn(), getOrderStatus: vi.fn(), getMarketTradeStatus: vi.fn() }));
vi.mock("@dya/wallet-ui/lib/near/http/account-client", () => ({ getSession: vi.fn(), getAllBalances: vi.fn() }));
const clients: QueryClient[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); });
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
it("polls a quiet Terminal session every minute instead of every five seconds", async () => {
  vi.mocked(getSession).mockResolvedValue({ account: null, passkeyOrigin: "http://localhost:3101" });
  renderHook(useTerminalData, { wrapper }); await tick();
  expect(getSession).toHaveBeenCalledOnce(); await tick(59_999); expect(getSession).toHaveBeenCalledOnce();
  await tick(1); expect(getSession).toHaveBeenCalledTimes(2);
});
it("polls unlocked balances every two minutes instead of every five seconds", async () => {
  vi.mocked(getAllBalances).mockResolvedValue({ balances: [], unavailableAssets: [] } as never);
  renderHook(() => useBalanceQuery("synthetic"), { wrapper }); await tick();
  expect(getAllBalances).toHaveBeenCalledOnce(); await tick(119_999); expect(getAllBalances).toHaveBeenCalledOnce();
  await tick(1); expect(getAllBalances).toHaveBeenCalledTimes(2);
});
it.each(["orders", "trades"] as const)("polls idle %s every minute", async kind => {
  vi.mocked(getOrders).mockResolvedValue({ orders: [] }); vi.mocked(getMarketTrades).mockResolvedValue({ trades: [] });
  const list = kind === "orders" ? getOrders : getMarketTrades;
  renderHook(() => kind === "orders" ? useOrders("synthetic") : useMarketTrades("synthetic"), { wrapper }); await tick();
  expect(list).toHaveBeenCalledOnce(); await tick(59_999); expect(list).toHaveBeenCalledOnce();
  await tick(1); expect(list).toHaveBeenCalledTimes(2);
});
it.each(["orders", "trades"] as const)("polls pending %s at five seconds, then slows after settlement", async kind => {
  const pending = { id: "synthetic", state: "creating" };
  const doneOrder = { id: "synthetic", state: "failed" };
  const doneTrade = { id: "synthetic", state: "settled", nearTxHashes: [], execution: { inputRaw: "8000000", outputRaw: "2000000000000000000000000", inputAmount: "8", outputAmount: "2", settledAt: 1000 } };
  vi.mocked(getOrders).mockResolvedValueOnce({ orders: [pending] } as never).mockResolvedValue({ orders: [doneOrder] } as never);
  vi.mocked(getMarketTrades).mockResolvedValueOnce({ trades: [pending] } as never).mockResolvedValue({ trades: [doneTrade] } as never);
  vi.mocked(getOrderStatus).mockResolvedValue({ order: pending } as never);
  vi.mocked(getMarketTradeStatus).mockResolvedValue({ trade: pending } as never);
  const list = kind === "orders" ? getOrders : getMarketTrades;
  renderHook(() => kind === "orders" ? useOrders("synthetic") : useMarketTrades("synthetic"), { wrapper }); await tick();
  expect(list).toHaveBeenCalledOnce(); await tick(4_999); expect(list).toHaveBeenCalledOnce();
  await tick(1); expect(list).toHaveBeenCalledTimes(2);
  await tick(59_999); expect(list).toHaveBeenCalledTimes(2);
  await tick(1); expect(list).toHaveBeenCalledTimes(3);
});
