import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { getSession } from "@dya/wallet-ui/lib/near/http/account-client";
import { useTerminalData } from "@/components/near/use-terminal-data";
vi.mock("@dya/wallet-ui/lib/near/http/account-client", () => ({ getSession: vi.fn() }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.resetAllMocks(); });
it("clears private Terminal caches when a session refresh reports sign-out", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  client.setQueryData(["near", "session"], { account: { id: "wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" });
  const balanceKey = ["near", "account", "wallet", "balances"];
  const activityKey = ["near", "account", "wallet", "orders", "confidential"];
  client.setQueryData(balanceKey, { amount: "synthetic-private-balance" });
  client.setQueryData(activityKey, [{ id: "synthetic-private-order" }]);
  client.setQueryData(["near", "catalog"], { assets: [] });
  vi.mocked(getSession).mockResolvedValue({ account: null, passkeyOrigin: "https://id.example.test" });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => { const terminal = useTerminalData(); return { data: terminal.session.data, refetch: terminal.session.refetch }; }, { wrapper });
  await act(async () => { const result = await hook.result.current.refetch(); expect(result.error).toBeNull(); });
  await waitFor(() => expect(hook.result.current.data?.account).toBeNull());
  expect(client.getQueryData(balanceKey)).toBeUndefined();
  expect(client.getQueryData(activityKey)).toBeUndefined();
  expect(client.getQueryData(["near", "catalog"])).toEqual({ assets: [] });
});

it.each(["wallet", "other-wallet"])("preserves or clears private cache according to the observed account identity: %s", async id => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  client.setQueryData(["near", "session"], { account: { id: "wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" });
  const key = ["near", "account", "wallet", "balances"];
  client.setQueryData(key, { synthetic: true });
  vi.mocked(getSession).mockResolvedValue({ account: { id, kind: "passkey" }, passkeyOrigin: "https://id.example.test" });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => { const terminal = useTerminalData(); return { data: terminal.session.data, refetch: terminal.session.refetch }; }, { wrapper });
  await act(async () => { await hook.result.current.refetch(); });
  await waitFor(() => expect(hook.result.current.data?.account?.id).toBe(id));
  expect(client.getQueryData(key)).toEqual(id === "wallet" ? { synthetic: true } : undefined);
});

it("cancels in-flight private queries so a late result cannot repopulate a signed-out cache", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  client.setQueryData(["near", "session"], { account: { id: "wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" });
  let finish!: (value: { synthetic: boolean }) => void;
  let requestSignal!: AbortSignal;
  const key = ["near", "account", "wallet", "balances"];
  const privateRequest = client.fetchQuery({ queryKey: key, queryFn: ({ signal }) => { requestSignal = signal; return new Promise<{ synthetic: boolean }>(resolve => { finish = resolve; }); } }).catch(() => undefined);
  vi.mocked(getSession).mockResolvedValue({ account: null, passkeyOrigin: "https://id.example.test" });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => { const terminal = useTerminalData(); return { data: terminal.session.data, refetch: terminal.session.refetch }; }, { wrapper });
  await act(async () => { await hook.result.current.refetch(); });
  expect(requestSignal.aborted).toBe(true);
  finish({ synthetic: true });
  await privateRequest;
  expect(client.getQueryData(key)).toBeUndefined();
});
