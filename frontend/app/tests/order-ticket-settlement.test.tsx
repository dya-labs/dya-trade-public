import { toast } from "@dya/ui/lib/toast";
import { TOAST_MESSAGES } from "@dya/config";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { trade } from "./fixtures/funding";
import { useOrderTicket } from "@/components/near/use-order-ticket";

vi.mock("@dya/ui/lib/toast", () => ({ toast: Object.assign(vi.fn(), { loading: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));
const provider = vi.hoisted(() => ({ settled: false, statusChecks: 0, concurrent: false, submitted: 0, amount: "4.9989", states: {} as Record<string, string> }));
beforeEach(() => { vi.clearAllMocks(); provider.settled = false;provider.statusChecks = 0;provider.concurrent = false;provider.submitted = 0;provider.amount = "4.9989";provider.states = {}; });
vi.mock("@dya/wallet-sdk", () => ({ startAuthentication: async () => ({ id: "assertion" }), connect: vi.fn() }));
vi.mock("@dya/wallet-ui/lib/near/http/account-client", () => ({
  getAllBalances: async () => ({ assets: [{ ...DEFAULT_PAIR.quote, raw: "0", amount: provider.concurrent ? provider.amount : provider.settled ? "2.9791" : "4.9989" }] }),
}));
vi.mock("@/lib/near/http/trading-client", () => ({
  abandonLimitOrder: vi.fn(), prepareLimitOrder: vi.fn(), prepareMarketOrder: async () => ({ review: trade(), options: { challenge: "synthetic" } }), previewLimitOrder: vi.fn(), previewMarketOrder: async () => trade(), submitLimitOrder: vi.fn(),
  submitMarketOrder: async () => ({ trade: { id: provider.concurrent ? `trade-${++provider.submitted}` : "trade", state: "submitted" } }),
  // Settles on the second check, after the submission-time balance refresh has already run.
  getMarketTradeStatus: async (id: string) => {
    if (provider.concurrent) return { trade: { id, state: provider.states[id] ?? "submitted" } };
    provider.statusChecks += 1;
    if (provider.statusChecks > 1) provider.settled = true;
    return { trade: { id: "trade", state: provider.settled ? "settled" : "submitted" } };
  },
}));

it("refreshes balances when a submitted market trade settles", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useOrderTicket({ id: "account", kind: "passkey" }, 5), { wrapper });
  await waitFor(() => expect(result.current.balances?.assets[0].amount).toBe("4.9989"));
  act(() => result.current.setQuantity("1"));
  await act(() => result.current.openReview());
  expect(toast.loading).toHaveBeenCalledWith(TOAST_MESSAGES.tradeProcessing, expect.objectContaining({ id: expect.any(String) }));
  expect(toast.success).not.toHaveBeenCalled();
  const toastId = vi.mocked(toast.loading).mock.calls[0][1]!.id;
  await waitFor(() => expect(result.current.balances?.assets[0].amount).toBe("2.9791"), { timeout: 5000 });
  expect(toast.success).toHaveBeenCalledExactlyOnceWith(TOAST_MESSAGES.tradeCompleted, { id: toastId });
});

it.each(['settled', 'failed'] as const)('refreshes balances for an older %s market trade while a newer trade is still pending', async state => {
  provider.concurrent = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(() => useOrderTicket({ id: 'account', kind: 'passkey' }, 5), { wrapper });
  try {
    await waitFor(() => expect(view.result.current.balances?.assets[0].amount).toBe('4.9989'));
    for (let n = 0; n < 2; n++) {
      act(() => view.result.current.setQuantity('1'));
      await act(async () => { await view.result.current.openReview(); });
    }
    expect(provider.submitted).toBe(2);
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(client.getQueryData<{ state: string }>(['near', 'account', 'account', 'trade-settlement', 'trade-2'])?.state).toBe('submitted'));
    provider.states['trade-1'] = state;provider.amount = '3.5';
    await waitFor(() => expect(view.result.current.balances?.assets[0].amount).toBe('3.5'), { timeout: 4500 });
    expect(state === 'settled' ? toast.success : toast.error).toHaveBeenCalledWith(state === 'settled' ? TOAST_MESSAGES.tradeCompleted : TOAST_MESSAGES.tradeFailed, expect.objectContaining({ id: expect.any(String) }));
    expect(client.getQueryData<{ state: string }>(['near', 'account', 'account', 'trade-settlement', 'trade-2'])?.state).toBe('submitted');
    expect(client.getQueryCache().find({ queryKey: ['near', 'account', 'account', 'trade-settlement', 'trade-1'], exact: true })?.getObserversCount()).toBe(0);
    expect(client.getQueryCache().find({ queryKey: ['near', 'account', 'account', 'trade-settlement', 'trade-2'], exact: true })?.getObserversCount()).toBe(1);
  } finally { view.unmount();client.clear(); }
});

it.each(['settled', 'failed'] as const)('continues watching a submitted trade across a market-ticket remount until it becomes %s', async state => {
  provider.concurrent = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  let view = renderHook(() => useOrderTicket({ id: 'account', kind: 'passkey' }, 5), { wrapper });
  try {
    await waitFor(() => expect(view.result.current.balances?.assets[0].amount).toBe('4.9989'));
    act(() => view.result.current.setQuantity('1'));
    await act(async () => { await view.result.current.openReview(); });
    await waitFor(() => expect(client.getQueryData<{ state: string }>(['near', 'account', 'account', 'trade-settlement', 'trade-1'])?.state).toBe('submitted'));
    view.unmount();
    view = renderHook(() => useOrderTicket({ id: 'account', kind: 'passkey' }, 5, { ...DEFAULT_PAIR, id: 'synthetic-other-market', base: { ...DEFAULT_PAIR.base, assetId: 'synthetic:other-market' } }), { wrapper });
    provider.states['trade-1'] = state;provider.amount = '3.5';
    await waitFor(() => expect(view.result.current.balances?.assets[0].amount).toBe('3.5'), { timeout: 4500 });
    expect(client.getQueryCache().find({ queryKey: ['near', 'account', 'account', 'trade-settlement', 'trade-1'], exact: true })?.getObserversCount()).toBe(0);
  } finally { view.unmount();client.clear(); }
});

it.each(['another account', 'cleared account cache'] as const)('does not resume a pending trade for %s', async scenario => {
  provider.concurrent = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  let view = renderHook(() => useOrderTicket({ id: 'account', kind: 'passkey' }, 5), { wrapper });
  const pendingKey = ['near', 'account', 'account', 'pending-trade-settlements'];
  try {
    await waitFor(() => expect(view.result.current.balances?.assets[0].amount).toBe('4.9989'));
    act(() => view.result.current.setQuantity('1'));
    await act(async () => { await view.result.current.openReview(); });
    await waitFor(() => expect(client.getQueryData(pendingKey)).toEqual(['trade-1']));
    view.unmount();
    if (scenario === 'cleared account cache') client.removeQueries({ queryKey: ['near', 'account'] });
    const nextAccount = scenario === 'another account' ? 'other-account' : 'account';
    view = renderHook(() => useOrderTicket({ id: nextAccount, kind: 'passkey' }, 5), { wrapper });
    await waitFor(() => expect(view.result.current.balances?.assets[0].amount).toBe('4.9989'));
    expect(client.getQueryData(['near', 'account', nextAccount, 'pending-trade-settlements'])).toEqual([]);
    expect(client.getQueryCache().find({ queryKey: ['near', 'account', 'account', 'trade-settlement', 'trade-1'], exact: true })?.getObserversCount() ?? 0).toBe(0);
    if (scenario === 'another account') expect(client.getQueryData(pendingKey)).toEqual(['trade-1']);
  } finally { view.unmount();client.clear(); }
});
