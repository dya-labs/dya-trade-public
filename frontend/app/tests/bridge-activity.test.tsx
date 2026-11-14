import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { BridgeActivity, useBridgeActivity } from "@/components/near/bridge-activity";
import { Table, TableBody } from "@dya/ui/components/table";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { networkFor } from "@/lib/near/domain/bridge-networks";
import { getBridgeDeposits } from "@/lib/near/http/transfers-client";
import { getBridgeDeposits as storyDeposits, setTransferState } from "@/stories/transfers/api-mocks";
import { getCatalog } from "@/stories/deposit/api-mocks";

const base = { ...DEFAULT_PAIR.quote, assetId: "nep141:base-usdc.omft.near", blockchain: "base" };
vi.mock("@dya/wallet-ui/hooks/use-wallet-queries", () => ({ useCatalogQuery: () => ({ data: { assets: [base] } }) }));
vi.mock("@/lib/near/http/transfers-client", () => ({ getBridgeDeposits: vi.fn() }));
const deposit = { assetId: base.assetId, chain: "eth:8453", amount: "250000000", decimals: 6, status: "COMPLETED" as const, txHash: "synthetic", address: "synthetic" };
const clients: QueryClient[] = [];
afterEach(() => { cleanup();clients.splice(0).forEach(client => client.clear());vi.useRealTimers();vi.resetAllMocks();setTransferState(null); });
function query(data = [deposit], extra: Record<string, unknown> = {}) { return { data: { deposits: data }, refetch: vi.fn(), ...extra } as unknown as ReturnType<typeof useBridgeActivity>; }
function hook(accountId: string | null = "alice") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(({ id }) => ({ ...useBridgeActivity(id) }), { initialProps: { id: accountId }, wrapper }) };
}
async function advance(ms = 1) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

it("uses a protocol chain and matching catalog identity in the direct-deposit example", async () => {
  setTransferState("DirectDeposits");
  const item = (await storyDeposits()).deposits[0];
  const asset = (await getCatalog()).assets.find(asset => asset.assetId === item.assetId)!;
  expect(asset).toBeDefined();
  expect(networkFor(item.chain)).toBe(asset.blockchain);
  expect(item.decimals).toBe(asset.decimals);
  expect(asset.blockchain).toBe("base");
});
it.each([['PENDING','Processing'],['COMPLETED','Credited'],['FAILED','Bridge processing failed']] as const)("shows the exact amount and %s status", (status, label) => {
  render(<BridgeActivity query={query([{ ...deposit, status } as typeof deposit])} />);
  expect(screen.getByText("Direct deposits")).toBeInTheDocument();
  expect(screen.getByText("250 USDC")).toBeInTheDocument();
  expect(screen.getByText(label)).toBeInTheDocument();
});
it("keeps unknown token identity and a raw amount beyond safe integer precision", () => {
  render(<BridgeActivity query={query([{ ...deposit, assetId: "nep245:unknown", amount: "1000000000000000001", decimals: 18 }])} />);
  expect(screen.getByText("1.000000000000000001 nep245:unknown")).toBeInTheDocument();
});
it("preserves cached deposits while retrying without exposing provider errors", () => {
  const state = query([deposit], { error: new Error("Synthetic private upstream") });
  const view = render(<BridgeActivity query={state} />);
  expect(screen.getByText("Status unavailable")).toBeInTheDocument();
  expect(screen.getByText("250 USDC")).toBeInTheDocument();
  expect(screen.queryByText("Credited")).not.toBeInTheDocument();
  expect(screen.queryByText("Synthetic private upstream")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));expect(state.refetch).toHaveBeenCalledOnce();
  view.rerender(<BridgeActivity query={{ ...state, isFetching: true }} />);
  expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
});
it("does not add a direct-deposit heading for an empty successful response", () => {
  const { container } = render(<BridgeActivity query={query([])} />);expect(container).toBeEmptyDOMElement();
});
it("polls every fifteen seconds and invalidates only the current account balances", async () => {
  vi.useFakeTimers();vi.mocked(getBridgeDeposits).mockResolvedValue({ deposits: [deposit] });
  const result = hook();const invalidate = vi.spyOn(result.client, "invalidateQueries");
  await advance();expect(getBridgeDeposits).toHaveBeenCalledOnce();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["near", "account", "alice", "balances"] });
  await advance(15_000);expect(getBridgeDeposits).toHaveBeenCalledTimes(2);
  expect(invalidate.mock.calls.every(([options]) => options?.queryKey?.[2] === "alice")).toBe(true);
  result.rerender({ id: null });await advance(30_000);expect(getBridgeDeposits).toHaveBeenCalledTimes(2);
});
it("recovers an initial provider failure through the real query refetch", async () => {
  vi.useFakeTimers();vi.mocked(getBridgeDeposits).mockRejectedValueOnce(new Error("Synthetic offline")).mockRejectedValueOnce(new Error("Synthetic offline")).mockResolvedValueOnce({ deposits: [deposit] });
  const result = hook();await advance(10);await advance();expect(result.result.current.isError).toBe(true);
  await act(async () => { await result.result.current.refetch(); });await advance();
  expect(result.result.current.isSuccess).toBe(true);expect(result.result.current.data?.deposits).toEqual([deposit]);
});
it("does not fetch direct deposits while signed out", async () => {
  vi.useFakeTimers();hook(null);await advance(30_000);expect(getBridgeDeposits).not.toHaveBeenCalled();
});

it("uses shared details for direct-deposit rows and preserves the selected deposit when polling reorders rows", () => {
  const client = new QueryClient(); clients.push(client);
  client.setQueryData(["near", "network-icons", 2], { icons: {} });
  const other = { ...deposit, txHash: "other", amount: "1000000" };
  const body = (data: typeof deposit[]) => <QueryClientProvider client={client}><Table><TableBody><BridgeActivity query={query(data)} asRows /></TableBody></Table></QueryClientProvider>;
  const view = render(body([deposit, other]));
  fireEvent.click(screen.getByRole("row", { name: "View direct deposit 1 details" }));
  expect(screen.getByRole("dialog", { name: "Deposited" })).toHaveTextContent("250.00 USDC");
  view.rerender(body([other, deposit]));
  expect(screen.getByRole("dialog", { name: "Deposited" })).toHaveTextContent("250.00 USDC");
  expect(screen.queryByText("From")).toBeNull();
});
