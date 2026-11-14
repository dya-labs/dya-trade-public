vi.mock("@/lib/near/http/trading-client", () => ({ getMarketTrades: async () => ({ trades: [] }) }));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WalletMenu } from "@/components/near/wallet-menu";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";

const state = vi.hoisted(() => ({ depositError: false, mode: "normal", depositGate: null as Promise<void> | null }));
vi.mock("@/components/near/use-live-balances", () => ({ useBalanceQuery: () => ({ data: { assets: [{ ...DEFAULT_PAIR.quote, amount: "1", raw: "1000000" }] }, error: null }) }));
vi.mock("@dya/wallet-ui/hooks/use-wallet-queries", () => ({ useCatalogQuery: () => ({ data: { assets: [DEFAULT_PAIR.quote] }, error: null }) }));
vi.mock("@/lib/near/http/catalog-client", () => ({ getTokenMarkets: async () => ({ assets: {} }) }));
vi.mock("@/components/near/asset-mark", () => ({ AssetMark: ({ processing, network }: { processing?: boolean; network?: string }) => <span data-testid="activity-token" data-processing={!!processing} data-network={network} /> }));
vi.mock("@/components/near/network-mark", () => ({ NetworkMark: () => null }));
vi.mock("@/lib/near/http/funding-conversions-client", () => ({ fundingHistory: async () => {
  if (state.mode === "error") throw new Error("Synthetic private upstream detail");
  if (state.mode === "empty") return { operations: [] };
  if (state.mode === "processing") return { operations: [{ id: "processing", createdAt: 700000, state: "processing", outputAmount: "1.998", legs: [{ id: "submitted-leg", state: "submitted", review: { estimatedOutput: "1.998" } }] }] };
  if (state.mode === "partial") return { operations: [{ id: "partial", createdAt: 700000, state: "partial", legs: [
    { id: "settled-leg", state: "settled", review: { estimatedOutput: "12.5" } },
    { id: "failed-leg", state: "failed", review: { estimatedOutput: "99" } },
    { id: "ready-leg", state: "ready", review: { estimatedOutput: "88" } },
  ] }] };
  return { operations: [
  { id: "conversion", createdAt: 400000, state: "settled", legs: [{ id: "settled-leg", state: "settled", review: { estimatedOutput: "44" } }] },
  { id: "unsigned-conversion", createdAt: 900000, state: "ready", legs: [{ id: "ready-leg", state: "ready", review: { estimatedOutput: "99" } }] },
] }; } }));
vi.mock("@/lib/near/http/transfers-client", () => ({
  getWithdrawals: async () => {
    if (state.mode === "error") throw new Error("Synthetic private upstream detail");
    if (state.mode !== "normal") return { withdrawals: [] };
    return { withdrawals: [
    { id: "withdrawal-new", createdAt: 600000, state: "settled", review: { asset: "USDC", amount: "66", destinationChain: "Base" } },
    { id: "withdrawal-old", createdAt: 300000, state: "settled", review: { asset: "USDC", amount: "33", destinationChain: "Base" } },
  ] }; },
  getDeposits: async () => {
    if (state.depositGate) await state.depositGate;
    if (state.mode === "error" || state.depositError) throw new Error("Synthetic private upstream detail");
    if (state.mode !== "normal") return { deposits: [] };
    return { deposits: [
      { id: "deposit-new", createdAt: 500000, status: "SUCCESS", creditedAmount: "55", quote: { asset: "USDC", sourceChain: "Base", amountInFormatted: "555" } },
      { id: "deposit-old", createdAt: 200000, status: "SUCCESS", creditedAmount: "22", quote: { asset: "USDC", sourceChain: "Base", amountInFormatted: "222" } },
      { id: "awaiting-deposit", createdAt: 900001, status: "PENDING_DEPOSIT", quote: { asset: "USDC", sourceChain: "Base" } },
    ] };
  },
  getBridgeDeposits: async () => {
    if (state.mode === "error") throw new Error("Synthetic private upstream detail");
    if (state.mode !== "normal") return { deposits: [] };
    return { deposits: [{ chain: "eth:8453", txHash: "synthetic", assetId: DEFAULT_PAIR.quote.assetId, amount: "11000000", decimals: 6, status: "COMPLETED" }] }; },
}));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); state.depositError = false; state.mode = "normal"; state.depositGate = null; });
async function openActivity() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><WalletMenu account={{ id: "synthetic-account", kind: "passkey" }} onDeposit={() => {}} onWithdraw={() => {}} onFunding={() => {}} onSignOut={() => {}} onActivity={() => {}} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Open wallet" }));
  fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
  return screen.getByRole("tabpanel", { name: "Activity" });
}
const amounts = (activity: HTMLElement) => within(activity).getAllByTitle(/USDC/).map(element => element.getAttribute("title"));
it("combines histories newest first,caps at five,and excludes unstarted funding and awaiting deposits", async () => {
  const activity = await openActivity();
  await waitFor(() => expect(amounts(activity)).toEqual(["66 USDC", "55 USDC", "44 USDC (estimated)", "33 USDC", "22 USDC"]));
  expect(within(activity).queryByText("555.00 USDC")).toBeNull();
  expect(within(activity).queryByText("222.00 USDC")).toBeNull();
});
it("keeps available histories visible when deposit history fails without exposing upstream details", async () => {
  state.depositError = true;
  const activity = await openActivity();
  await within(activity).findByText("Some activity is unavailable.");
  await waitFor(() => expect(amounts(activity)).toEqual(["66 USDC", "44 USDC (estimated)", "33 USDC", "11 USDC"]));
  expect(within(activity).queryByText("Synthetic private upstream detail")).toBeNull();
  expect(within(activity).queryByText("No activity yet")).toBeNull();
});

it("shows an empty state only after all histories successfully return empty", async () => {
  state.mode = "empty";
  const activity = await openActivity();
  await within(activity).findByText("No activity yet");
  expect(within(activity).queryByText("Some activity is unavailable.")).toBeNull();
  expect(within(activity).queryAllByTitle(/USDC/)).toHaveLength(0);
});
it("shows a safe unavailable state when all histories fail instead of claiming no activity", async () => {
  state.mode = "error";
  const activity = await openActivity();
  await within(activity).findByText("Some activity is unavailable.");
  await waitFor(() => expect(clients[0].isFetching()).toBe(0));
  expect(within(activity).queryByText("No activity yet")).toBeNull();
  expect(within(activity).queryByText("Synthetic private upstream detail")).toBeNull();
  expect(within(activity).getByRole("button", { name: "View all activity" })).toBeVisible();
});
it("shows each submitted route separately without partial batch status or unsigned routes", async () => {
  state.mode = "partial";
  const activity = await openActivity();
  await waitFor(() => expect(within(activity).getAllByText("Transfer to trading")).toHaveLength(2));
  expect(amounts(activity)).toEqual(["12.5 USDC (estimated)", "99 USDC (estimated)"]);
  expect(within(activity).getAllByText("Transfer to trading")).toHaveLength(2);
  expect(within(activity).getByText(/Failed or refunded/)).toBeVisible();
  expect(within(activity).queryByText(/Partially/)).toBeNull();
  expect(within(activity).queryByText(/Completed/)).toBeNull();
  for (const icon of within(activity).getAllByTestId("activity-token")) expect(icon).toHaveAttribute("data-network", "near");
  expect(within(activity).queryByText("No activity yet")).toBeNull();
});

it("waits for the final pending history before showing the empty state", async () => {
  state.mode = "empty";
  let release!: () => void;
  state.depositGate = new Promise<void>(resolve => { release = resolve; });
  const activity = await openActivity();
  await waitFor(() => expect(clients[0].isFetching()).toBe(1));
  expect(activity.querySelector('[skullet-loading]')).not.toBeNull();
  expect(within(activity).queryByText("No activity yet")).toBeNull();
  expect(within(activity).queryByText("Some activity is unavailable.")).toBeNull();
  await act(async () => { release(); });
  await within(activity).findByText("No activity yet");
  expect(activity.querySelector('[skullet-loading]')).toBeNull();
});
it("shows available history while another source is pending then merges the resolved source", async () => {
  let release!: () => void;
  state.depositGate = new Promise<void>(resolve => { release = resolve; });
  const activity = await openActivity();
  await waitFor(() => expect(amounts(activity)).toEqual(["66 USDC", "44 USDC (estimated)", "33 USDC", "11 USDC"]));
  expect(within(activity).getByRole("status")).toHaveTextContent("Loading more activity");
  expect(activity.querySelector('[skullet-loading]')).toBeNull();
  expect(within(activity).queryByText("No activity yet")).toBeNull();
  await act(async () => { release(); });
  await waitFor(() => expect(amounts(activity)).toEqual(["66 USDC", "55 USDC", "44 USDC (estimated)", "33 USDC", "22 USDC"]));
  expect(activity.querySelector('[skullet-loading]')).toBeNull();
});
it("retains last known activity on failed refresh and clears the warning after recovery", async () => {
  const activity = await openActivity();
  const expected = ["66 USDC", "55 USDC", "44 USDC (estimated)", "33 USDC", "22 USDC"];
  await waitFor(() => expect(amounts(activity)).toEqual(expected));
  state.mode = "error";
  await act(async () => { await clients[0].refetchQueries({ queryKey: ["near", "account", "synthetic-account"] }); });
  await within(activity).findByText("Some activity is unavailable.");
  expect(amounts(activity)).toEqual(expected);
  expect(within(activity).queryByText("No activity yet")).toBeNull();
  expect(within(activity).queryByText("Synthetic private upstream detail")).toBeNull();
  state.mode = "normal";
  await act(async () => { await clients[0].refetchQueries({ queryKey: ["near", "account", "synthetic-account"] }); });
  await waitFor(() => expect(within(activity).queryByText("Some activity is unavailable.")).toBeNull());
  expect(amounts(activity)).toEqual(expected);
});

it("shows the pending batch quote and spinner instead of a zero settled-route total", async () => {
  state.mode = "processing";
  const activity = await openActivity();
  await within(activity).findByText("Transfer to trading");
  expect(amounts(activity)).toEqual(["1.998 USDC (estimated)"]);
  expect(within(activity).getByText("≈ 1.99 USDC")).toBeVisible();
  expect(within(activity).getByLabelText("Estimated received amount")).toBeInTheDocument();
  expect(within(activity).getByTestId("activity-token")).toHaveAttribute("data-processing", "true");
  expect(within(activity).queryByText("0 USDC (estimated)")).toBeNull();
});
