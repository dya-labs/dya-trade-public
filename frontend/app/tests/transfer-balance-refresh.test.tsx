import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useTransfers } from "@dya/wallet-ui/hooks/use-transfers";
import { getDeposits, getDepositStatus, getWithdrawals, getWithdrawalStatus } from "@dya/wallet-ui/lib/near/http/transfers-client";
import { fixtures, setTransferState } from "@/stories/transfers/api-mocks";
vi.mock("@dya/wallet-ui/lib/near/http/transfers-client", () => ({ getDeposits: vi.fn(), getDepositStatus: vi.fn(), getWithdrawals: vi.fn(), getWithdrawalStatus: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const balanceKey = ["near", "account", "wallet", "balances", "confidential", "all"];
function fixture() { setTransferState("Processing");const value = fixtures();value.deposits[0].createdAt = Date.now();return value; }
function setup(active = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),read = vi.fn(async () => ({ amount: "9" }));client.setQueryData(balanceKey, { amount: "10" });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(() => ({ transfers: useTransfers("wallet"), balance: useQuery({ queryKey: balanceKey, queryFn: read, enabled: active, staleTime: Infinity }) }), { wrapper });
  return { client,read,view,close() { view.unmount();client.clear(); } };
}
it.each(["deposit", "withdrawal"] as const)("invalidates balances when the first %s history poll discovers settlement", async kind => {
  const current = fixture();if(kind === "deposit")current.withdrawals=[];else current.deposits=[];
  vi.mocked(getDeposits).mockImplementation(async()=>({deposits:structuredClone(current.deposits)}));vi.mocked(getWithdrawals).mockImplementation(async()=>({withdrawals:structuredClone(current.withdrawals)}));
  vi.mocked(getDepositStatus).mockImplementation(async()=>{current.deposits[0].status="SUCCESS";return {deposit:current.deposits[0],providerStatus:"SUCCESS"};});
  vi.mocked(getWithdrawalStatus).mockImplementation(async()=>{current.withdrawals[0].state="settled";return {withdrawal:current.withdrawals[0]};});
  const t=setup();try {await waitFor(()=>expect(t.view.result.current.transfers.isSuccess).toBe(true));expect(t.client.getQueryState(balanceKey)?.isInvalidated).toBe(true);}finally{t.close();}
});
it.each(["deposit", "withdrawal"] as const)("invalidates balances when a new terminal %s appears after an empty history", async kind => {
  let current: ReturnType<typeof fixture>={deposits:[],withdrawals:[]};
  vi.mocked(getDeposits).mockImplementation(async()=>({deposits:structuredClone(current.deposits)}));vi.mocked(getWithdrawals).mockImplementation(async()=>({withdrawals:structuredClone(current.withdrawals)}));
  const t=setup();try {await waitFor(()=>expect(t.view.result.current.transfers.isSuccess).toBe(true));current=fixture();if(kind==="deposit"){current.withdrawals=[];current.deposits[0].status="SUCCESS";}else{current.deposits=[];current.withdrawals[0].state="failed";}await act(async()=>{await t.view.result.current.transfers.refetch();});expect(t.client.getQueryState(balanceKey)?.isInvalidated).toBe(true);}finally{t.close();}
});
it("does not repeatedly invalidate balances for unchanged terminal transfers", async()=>{
  const current=fixture();current.deposits[0].status="SUCCESS";current.withdrawals[0].state="settled";
  vi.mocked(getDeposits).mockResolvedValue({deposits:current.deposits});vi.mocked(getWithdrawals).mockResolvedValue({withdrawals:current.withdrawals});
  const t=setup();try{await waitFor(()=>expect(t.view.result.current.transfers.isSuccess).toBe(true));await act(async()=>{await t.view.result.current.transfers.refetch();});expect(t.client.getQueryState(balanceKey)?.isInvalidated).toBe(false);expect(getDepositStatus).not.toHaveBeenCalled();expect(getWithdrawalStatus).not.toHaveBeenCalled();}finally{t.close();}
});
it("retains pending records and unavailable IDs when status checks fail without invalidating balances", async()=>{
  const current=fixture();vi.mocked(getDeposits).mockResolvedValue({deposits:current.deposits});vi.mocked(getWithdrawals).mockResolvedValue({withdrawals:current.withdrawals});vi.mocked(getDepositStatus).mockRejectedValue(new Error("Synthetic status outage"));vi.mocked(getWithdrawalStatus).mockRejectedValue(new Error("Synthetic status outage"));
  const t=setup();try{await waitFor(()=>expect(t.view.result.current.transfers.isSuccess).toBe(true));expect(t.view.result.current.transfers.data?.unavailableIds).toEqual(expect.arrayContaining([current.deposits[0].id,current.withdrawals[0].id]));expect(t.view.result.current.transfers.data?.withdrawals[0].state).toBe("submitted");expect(t.client.getQueryState(balanceKey)?.isInvalidated).toBe(false);}finally{t.close();}
});
it("refetches an active balance observer after settlement in the first transfer poll", async()=>{
  const current=fixture();current.deposits=[];vi.mocked(getDeposits).mockResolvedValue({deposits:[]});vi.mocked(getWithdrawals).mockImplementation(async()=>({withdrawals:structuredClone(current.withdrawals)}));vi.mocked(getWithdrawalStatus).mockImplementation(async()=>{current.withdrawals[0].state="settled";return {withdrawal:current.withdrawals[0]};});
  const t=setup(true);try{await waitFor(()=>expect(t.view.result.current.balance.data?.amount).toBe("9"));expect(t.read).toHaveBeenCalledTimes(1);}finally{t.close();}
});
