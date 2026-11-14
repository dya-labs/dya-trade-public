import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { getAllBalances, getSession } from "@dya/wallet-ui/lib/near/http/account-client";
import { useBalanceQuery } from "@dya/wallet-ui/hooks/use-live-balances";
import { useWalletSessionQuery } from "@dya/wallet-ui/hooks/use-wallet-queries";
import { ConfidentialAccessRequired } from "@dya/wallet-contracts/src/domain/confidential-access-error";
vi.mock("@dya/wallet-ui/lib/near/http/transfers-client", () => ({ getWithdrawals: vi.fn(), getDeposits: vi.fn(), getWithdrawalStatus: vi.fn(), getDepositStatus: vi.fn() }));
vi.mock("@dya/wallet-ui/lib/near/http/account-client", () => ({ getAllBalances: vi.fn(), getSession: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); focusManager.setFocused(undefined); });
const key = ["near", "account", "wallet", "balances", "confidential", "all"];
const data = { accountId: "wallet", blockHeight: 1, checkedAt: 1, assets: [] };
function setup() {
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper = ({children}: {children: ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return {client,wrapper};
}
it("hides previously cached balances when confidential authorization expires", async () => {
  vi.mocked(getAllBalances).mockResolvedValueOnce(data).mockRejectedValue(new ConfidentialAccessRequired());
  const {client,wrapper} = setup();
  const view = renderHook(()=>useBalanceQuery("wallet"),{wrapper});
  await waitFor(()=>expect(view.result.current.data).toEqual(data));
  await act(async()=>{await view.result.current.refetch();});
  await waitFor(()=>expect(view.result.current.data).toBeUndefined());
  view.unmount();client.clear();
});
it("refreshes stale balances when the visible tab regains focus", async () => {
  vi.mocked(getAllBalances).mockResolvedValue(data);
  const {client,wrapper} = setup();
  const view = renderHook(()=>useBalanceQuery("wallet"),{wrapper});
  await waitFor(()=>expect(view.result.current.data).toEqual(data));
  await act(async()=>{
    client.setQueryData(key,data,{updatedAt:Date.now()-31000});
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(()=>expect(getAllBalances).toHaveBeenCalledTimes(2));
  view.unmount();client.clear();
});
it("clears private account queries when a session refresh reports sign-out", async () => {
  const {client,wrapper} = setup();
  client.setQueryData(["near","session"],{account:{id:"wallet",kind:"passkey"},passkeyOrigin:"https://id.example.test"});
  client.setQueryData(key,data);
  vi.mocked(getSession).mockResolvedValue({account:null,passkeyOrigin:"https://id.example.test"});
  const view = renderHook(()=>{ const query = useWalletSessionQuery(); return {data:query.data,refetch:query.refetch}; },{wrapper});
  await act(async()=>{ const result = await view.result.current.refetch(); expect(result.error).toBeNull(); });
  expect(client.getQueryData(key)).toBeUndefined();
  await waitFor(()=>expect(view.result.current.data?.account).toBeNull());
  view.unmount();client.clear();
});

it("invalidates cached balances when a pending transfer settles", async () => {
  const { useTransfers } = await import("@dya/wallet-ui/hooks/use-transfers");
  const { getWithdrawals, getDeposits, getWithdrawalStatus } = await import("@dya/wallet-ui/lib/near/http/transfers-client");
  const { client, wrapper } = setup();
  client.setQueryData(key, data);
  let settled = false;
  const operation = () => ({id:"send",state:settled ? "settled" as const : "submitted" as const,destinationChainTxHashes:[],createdAt:1,review:{direction:"withdraw" as const,sourceChain:"NEAR Intents" as const,destinationChain:"Base",asset:"USDC",amount:"1",amountRaw:"1000000",destinationWallet:"receiver",destinationAsset:"base-usdc",expectedReceive:"1",minimumReceive:"0.99",available:"10",balanceBlock:1,deadline:"2099-01-01T00:00:00Z",depositAddress:"deposit",depositMemo:null,correlationId:"test"}});
  vi.mocked(getWithdrawals).mockImplementation(async()=>({withdrawals:[operation()]}));
  vi.mocked(getDeposits).mockResolvedValue({deposits:[]});
  vi.mocked(getWithdrawalStatus).mockImplementation(async()=>({withdrawal:operation()}));
  const view = renderHook(()=>{const query=useTransfers("wallet");return {data:query.data,refetch:query.refetch};},{wrapper});
  await waitFor(()=>expect(view.result.current.data?.withdrawals[0].state).toBe("submitted"));
  settled=true;
  await act(async()=>{await view.result.current.refetch();});
  await waitFor(()=>expect(view.result.current.data?.withdrawals[0].state).toBe("settled"));
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  view.unmount();client.clear();
});
