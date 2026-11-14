import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useOrders } from "@/components/near/use-activity";
import { getOrders, getOrderStatus } from "@/lib/near/http/trading-client";
import { getOrders as fixtureOrders, setOrdersState } from "@/stories/orders/api-mocks";
import type { StoredOrder } from "@/lib/near/http/schemas/trading";
vi.mock("@/lib/near/http/trading-client", () => ({ getOrders: vi.fn(), getOrderStatus: vi.fn(), getMarketTrades: vi.fn(), getMarketTradeStatus: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const balances = ["near", "account", "wallet", "balances", "confidential", "all"];
async function order() { setOrdersState("PartiallyFilled"); return (await fixtureOrders()).orders[0]; }
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(balances, { assets: [] });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(() => useOrders("wallet"), { wrapper });
  return { client, view, close() { view.unmount(); client.clear(); } };
}
it("refreshes balances when a status poll reports a new fill status", async () => {
  const before = await order(), after = structuredClone(before);after.provider!.fillStatus = "FILLED";
  vi.mocked(getOrders).mockResolvedValue({ orders: [before] });vi.mocked(getOrderStatus).mockResolvedValue({ order: after });
  const t = setup();try { await waitFor(() => expect(t.view.result.current.data?.[0].provider?.fillStatus).toBe("FILLED"));expect(t.client.getQueryState(balances)?.isInvalidated).toBe(true); } finally { t.close(); }
});
it.each(["depositedAmount", "fillAmount", "payoutStatus", "payoutFinal", "fundingState"] as const)("refreshes balances when %s changes without a different fill status or fill count", async field => {
  const before = await order(), after = structuredClone(before);
  if (field === "depositedAmount") after.provider!.depositedAmount = "1";
  if (field === "fillAmount") after.provider!.partialFills[0].amountOut = "1";
  if (field === "payoutStatus") after.provider!.payoutStatus = "COMPLETED";
  if (field === "payoutFinal") after.provider!.payoutFinal = true;
  if (field === "fundingState") after.fundingState = "unknown";
  vi.mocked(getOrders).mockResolvedValue({ orders: [before] });vi.mocked(getOrderStatus).mockResolvedValue({ order: after });
  const t = setup();try { await waitFor(() => expect(t.view.result.current.isSuccess).toBe(true));expect(t.client.getQueryState(balances)?.isInvalidated).toBe(true); } finally { t.close(); }
});
it("refreshes balances when the list already contains changed fills before the status request", async () => {
  let current: StoredOrder = await order();
  vi.mocked(getOrders).mockImplementation(async () => ({ orders: [structuredClone(current)] }));vi.mocked(getOrderStatus).mockImplementation(async () => ({ order: structuredClone(current) }));
  const t = setup();try {
    await waitFor(() => expect(t.view.result.current.isSuccess).toBe(true));expect(t.client.getQueryState(balances)?.isInvalidated).toBe(false);
    current = structuredClone(current);current.provider!.partialFills[0].amountOut = "1";
    await act(async () => { await t.view.result.current.refetch(); });
    expect(t.client.getQueryState(balances)?.isInvalidated).toBe(true);
  } finally { t.close(); }
});
it("does not refresh balances for unchanged financial state or timestamp-only changes", async () => {
  let current = await order();
  vi.mocked(getOrders).mockImplementation(async () => ({ orders: [structuredClone(current)] }));vi.mocked(getOrderStatus).mockImplementation(async () => ({ order: structuredClone(current) }));
  const t = setup();try { await waitFor(() => expect(t.view.result.current.isSuccess).toBe(true));current = { ...current, updatedAt: current.updatedAt + 1 };await act(async () => { await t.view.result.current.refetch(); });expect(t.client.getQueryState(balances)?.isInvalidated).toBe(false); } finally { t.close(); }
});

it("refetches an active balance observer when order funding is detected", async () => {
  const before = await order(), after = structuredClone(before);after.provider!.depositedAmount = "1";
  vi.mocked(getOrders).mockResolvedValue({ orders: [before] });vi.mocked(getOrderStatus).mockResolvedValue({ order: after });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const read = vi.fn(async () => ({ amount: "9" }));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(() => {
    const balance = useQuery({ queryKey: balances, queryFn: read, initialData: { amount: "10" }, staleTime: Infinity });
    return { orders: useOrders("wallet"), balance };
  }, { wrapper });
  try { await waitFor(() => expect(view.result.current.balance.data.amount).toBe("9"));expect(read).toHaveBeenCalledTimes(1); } finally { view.unmount();client.clear(); }
});
