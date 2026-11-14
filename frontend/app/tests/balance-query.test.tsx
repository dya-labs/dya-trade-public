// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { useBalanceQuery } from "@/components/near/use-live-balances";
import { getAllBalances } from "@dya/wallet-ui/lib/near/http/account-client";
import { RateLimitError } from "@/lib/near/domain/rate-limit";
vi.mock("@dya/wallet-ui/lib/near/http/account-client", () => ({ getAllBalances: vi.fn() }));
it("shares balance data, retains it on failure, and blocks manual retries during cooldown", async () => {
  const data = { accountId: "account", blockHeight: 1, checkedAt: 1, assets: [] };
  vi.mocked(getAllBalances).mockResolvedValueOnce(data).mockRejectedValue(new RateLimitError(Date.now() + 345000));
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const one = renderHook(() => { const query = useBalanceQuery("account"); return { data: query.data, isError: query.isError, refetch: query.refetch }; }, { wrapper });
  const two = renderHook(() => { const query = useBalanceQuery("account"); return { data: query.data, isError: query.isError, refetch: query.refetch }; }, { wrapper });
  await waitFor(() => expect(two.result.current.data).toEqual(data));
  expect(getAllBalances).toHaveBeenCalledTimes(1);
  await act(async () => { await one.result.current.refetch(); });
  await waitFor(() => expect(two.result.current.isError).toBe(true));
  expect(two.result.current.data).toEqual(data);
  await act(async () => { await two.result.current.refetch(); });
  expect(getAllBalances).toHaveBeenCalledTimes(2);
  one.unmount(); two.unmount(); client.clear();
});

it("shares an initial balance cooldown across observers until the provider retry deadline", async () => {
  vi.mocked(getAllBalances).mockReset();
  const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const data = { accountId: "initial-cooldown", blockHeight: 1, checkedAt: 1, assets: [] };
  vi.mocked(getAllBalances).mockRejectedValueOnce(new RateLimitError(now + 60000)).mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const one = renderHook(() => { const query = useBalanceQuery("initial-cooldown"); return { data: query.data, isError: query.isError, refetch: query.refetch }; }, { wrapper });
  try {
    await waitFor(() => expect(one.result.current.isError).toBe(true));
    const two = renderHook(() => { const query = useBalanceQuery("initial-cooldown"); return { data: query.data, isError: query.isError, refetch: query.refetch }; }, { wrapper });
    try {
      await act(async () => { await two.result.current.refetch(); });
      expect(getAllBalances).toHaveBeenCalledOnce();
      expect(two.result.current.data).toBeUndefined();
      clock.mockReturnValue(now + 60001);
      await act(async () => { await two.result.current.refetch(); });
      await waitFor(() => expect(one.result.current.data).toEqual(data));
      expect(getAllBalances).toHaveBeenCalledTimes(2);
    } finally { two.unmount(); }
  } finally { one.unmount(); client.clear(); clock.mockRestore(); }
});
