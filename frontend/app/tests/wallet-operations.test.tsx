import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useWalletOperations } from "@dya/wallet-ui/hooks/use-wallet-operations";
import { request } from "@dya/wallet-ui/lib/near/http/request";
import { batch, trade } from "./fixtures/funding";
vi.mock("@dya/wallet-ui/lib/near/http/request", () => ({ request: vi.fn() }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.resetAllMocks(); });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  return renderHook(() => useWalletOperations("account"), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
it("lists submitted funding legs individually, omits unsigned legs, and reconciles pending trades", async () => {
  const funding = batch(); funding.legs[0].state = "settled"; funding.legs[1].state = "ready";
  const market = { id: "trade", state: "submitted", createdAt: 1, updatedAt: 1, review: trade() };
  vi.mocked(request).mockImplementation(async path => {
    if (path === "live/trades") return { trades: [market] } as never;
    if (path === "live/trades/status") return { trade: { ...market, state: "settled" } } as never;
    if (path === "funding/history") return { operations: [funding] } as never;
    throw Error("Unexpected path");
  });
  const hook = mount();
  await waitFor(() => expect(hook.result.current.items).toHaveLength(2));
  expect(hook.result.current.items[0].state).toBe("settled");
  expect(hook.result.current.items[1].id).toBe("funding:batch:0");
  expect(hook.result.current.items[1].amount).toBe(funding.legs[0].review.estimatedOutput);
  expect(request).toHaveBeenCalledWith("live/trades/status", expect.anything(), { id: "trade" }, expect.any(AbortSignal));
});
it("retains available trades when funding history fails", async () => {
  vi.mocked(request).mockImplementation(async path => {
    if (path === "live/trades") return { trades: [{ id: "trade", state: "settled", createdAt: 1, updatedAt: 1, review: trade() }] } as never;
    throw Error("Synthetic funding unavailable");
  });
  const hook = mount();
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.items).toHaveLength(1);
  expect(hook.result.current.items[0].id).toBe("trade:trade");
});
