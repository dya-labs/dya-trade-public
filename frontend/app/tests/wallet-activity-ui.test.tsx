import { toast } from "@dya/ui/lib/toast";
vi.mock("@dya/ui/lib/toast", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WalletActivity, activityDay } from "@dya/wallet-ui/components/wallet-activity";
import { fixtures, setTransferState } from "@/stories/transfers/api-mocks";
const operationState = vi.hoisted(() => ({ items: [] as ReturnType<typeof import("@dya/wallet-ui/hooks/use-wallet-operations").useWalletOperations>["items"], error: false, pending: false, refetch: vi.fn() }));
vi.mock("@dya/wallet-ui/hooks/use-wallet-operations", () => ({ useWalletOperations: () => ({ items: operationState.items, isPending: operationState.pending, isError: operationState.error, isFetching: false, refetch: operationState.refetch }) }));
const state = vi.hoisted(() => ({ query: {} as Record<string, unknown>, mutate: vi.fn(), reset: vi.fn(), checking: false, checkError: false, checkId: "" }));
vi.mock("@dya/wallet-ui/hooks/use-transfers", () => ({ useTransfers: () => state.query, useTransferStatusMutation: () => ({ mutate: state.mutate, reset: state.reset, isPending: state.checking, isError: state.checkError, variables: { id: state.checkId } }) }));
vi.mock("@dya/wallet-ui/hooks/use-wallet-queries", () => ({ useCatalogQuery: () => ({ data: { assets: [] } }) }));
const clients: QueryClient[] = [];
beforeEach(() => { operationState.items = []; operationState.error = false; operationState.pending = false; operationState.refetch.mockReset(); setTransferState("Mixed"); state.mutate.mockReset(); state.reset.mockReset(); state.checking = false; state.checkError = false; state.checkId = ""; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); clients.splice(0).forEach(client => client.clear()); });
function mount(status: "settled" | "failed" | "submitted" | "unknown", unavailable = false, hash?: string, options: { limit?: number; pageSize?: number; href?: string; groupByDay?: boolean } = {}) {
  const source = fixtures().withdrawals[0];
  if (hash) { source.review.destinationChain = "NEAR"; source.destinationChainTxHashes = [hash]; }
  state.query = { data: { withdrawals: [{ ...source, state: status }], deposits: [], unavailableIds: unavailable ? [source.id] : [] }, isPending: false };
  const client = new QueryClient(); clients.push(client); client.setQueryData(["near", "token-icons"], { icons: {} });
  const view = render(<QueryClientProvider client={client}><WalletActivity accountId="synthetic-wallet" {...options} /></QueryClientProvider>);
  return { ...source, client, view };
}
it.each(["settled", "failed", "submitted"] as const)("does not offer redundant status checks for a %s transfer", status => {
  mount(status);
  fireEvent.click(screen.getByRole("button", { name: /View (?:Send|Sent)/ }));
  expect(screen.getByRole("dialog", { name: "Transfer details" })).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Check status" })).not.toBeInTheDocument();
});
it.each([false, true])("offers status recovery for unconfirmed or unavailable transfers: unavailable=%s", unavailable => {
  const source = mount(unavailable ? "settled" : "unknown", unavailable);
  const label = unavailable ? "Status unavailable" : "Unconfirmed";
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`View (?:Send|Sent).*${label}`) }));
  const dialog = screen.getByRole("dialog", { name: "Transfer details" });
  expect(within(dialog).getByText(new RegExp(label))).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Check status" }));
  expect(state.mutate).toHaveBeenCalledExactlyOnceWith({ id: source.id, kind: "send" });
});

it("shows status-check progress and removes stale failure after polling confirms completion", () => {
  const source = mount("unknown");
  fireEvent.click(screen.getByRole("button", { name: /View (?:Send|Sent)/ }));
  state.checking = true; state.checkId = source.id;
  const refresh = () => source.view.rerender(<QueryClientProvider client={source.client}><WalletActivity accountId="synthetic-wallet" /></QueryClientProvider>);
  refresh();
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Checking…" })).toBeDisabled();
  state.checking = false; state.checkError = true;
  refresh();
  expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Status unavailable. Check again before resubmitting.");
  state.query = { data: { withdrawals: [{ ...source, state: "settled" }], deposits: [], unavailableIds: [] }, isPending: false };
  refresh();
  expect(within(screen.getByRole("dialog")).getByText(/Completed$/)).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Check status" })).not.toBeInTheDocument();
});
it("shows exact details and clears clipboard failure after recipient-copy retry", async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writeText = vi.fn().mockRejectedValueOnce(new Error("Denied")).mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    const hash = "HhuKXGFgafJUSvBUq3E1CbKpvBChk6e3gPjvW89W46e5";
    const source = mount("settled", false, hash);
    fireEvent.click(screen.getByRole("button", { name: /View (?:Send|Sent)/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(source.id)).toBeInTheDocument();
    expect(dialog.querySelector("time")).toHaveAttribute("dateTime", new Date(source.createdAt).toISOString());
    expect(within(dialog).getByRole("link", { name: "View transaction" })).toHaveAttribute("href", `https://nearblocks.io/txns/${hash}`);
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy recipient address" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Unable to copy address")));
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy recipient address" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Address copied" })).toBeInTheDocument());
    expect(writeText).toHaveBeenLastCalledWith(source.review.destinationWallet);
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  } finally { if (original) Object.defineProperty(navigator, "clipboard", original); else Reflect.deleteProperty(navigator, "clipboard"); }
});

it("distinguishes loading, confirmed empty and initial failure without fake empty history", () => {
  const source = mount("submitted");
  const refresh = () => source.view.rerender(<QueryClientProvider client={source.client}><WalletActivity accountId="synthetic-wallet" /></QueryClientProvider>);
  state.query = { isPending: true };
  refresh();
  expect(screen.getByRole("status")).toHaveTextContent("Loading activity…");
  expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
  state.query = { isPending: false, data: { withdrawals: [], deposits: [], unavailableIds: [] } };
  refresh();
  expect(screen.getByText("No activity yet")).toBeInTheDocument();
  const retry = vi.fn();
  state.query = { isPending: false, isError: true, error: new Error("private upstream details"), refetch: retry };
  refresh();
  expect(screen.getByRole("alert")).toHaveTextContent("Activity unavailable");
  expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
  expect(screen.queryByText("private upstream details")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry activity" }));
  expect(retry).toHaveBeenCalledOnce();
});

it("retains cached activity on refresh failure and disables Retry while fetching", () => {
  const source = mount("unknown");
  state.query = { ...state.query, isError: true, isFetching: true };
  source.view.rerender(<QueryClientProvider client={source.client}><WalletActivity accountId="synthetic-wallet" /></QueryClientProvider>);
  expect(screen.getByRole("status")).toHaveTextContent("Some activity couldn’t be updated.");
  expect(screen.getByRole("button", { name: /View (?:Send|Sent).*Unconfirmed/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
});

it("uses credited deposit amounts and accessible processing/failed/completed status labels", () => {
  const source = mount("submitted");
  const deposit = fixtures().deposits[0];
  const base = { withdrawals: [], unavailableIds: [] };
  state.query = { data: { ...base, deposits: [{ ...deposit, status: "PROCESSING", creditedAmount: undefined }] }, isPending: false };
  const refresh = () => source.view.rerender(<QueryClientProvider client={source.client}><WalletActivity accountId="synthetic-wallet" /></QueryClientProvider>);
  refresh();
  expect(screen.getByRole("button", { name: /View Receive(?:d)?.*Processing/ })).toHaveTextContent("-");
  state.query = { data: { ...base, deposits: [{ ...deposit, status: "SUCCESS", creditedAmount: "98.5" }] }, isPending: false };
  refresh();
  expect(screen.getByRole("button", { name: /View Receive(?:d)?.*Completed/ })).toHaveTextContent("98.5");
  state.query = { data: { ...base, deposits: [{ ...deposit, status: "FAILED", creditedAmount: undefined }] }, isPending: false };
  refresh();
  expect(screen.getByRole("button", { name: /View Receive(?:d)?.*Failed/ })).toBeInTheDocument();
});

it("orders activity newest first and exposes relative times with exact timestamps", () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const source = mount("submitted");
  const now = Date.now();
  state.query = { data: { withdrawals: [
    { ...source, id: "older", state: "failed", createdAt: now - 7200000 },
    { ...source, id: "newer", state: "settled", createdAt: now - 60000 },
  ], deposits: [], unavailableIds: [] }, isPending: false };
  source.view.rerender(<QueryClientProvider client={source.client}><WalletActivity accountId="synthetic-wallet" /></QueryClientProvider>);
  const rows = screen.getAllByRole("button", { name: /View (?:Send|Sent)/ });
  expect(rows[0]).toHaveAccessibleName(/Completed/);
  expect(rows[1]).toHaveAccessibleName(/Failed/);
  expect(within(rows[0]).getByText("1m ago")).toHaveAttribute("dateTime", new Date(now - 60000).toISOString());
  expect(within(rows[1]).getByText("2h ago")).toHaveAttribute("dateTime", new Date(now - 7200000).toISOString());
});
it("keeps activity rows and details usable when a recorded timestamp is outside the Date range", () => {
  const source = mount("settled");
  state.query = { data: { withdrawals: [{ ...source, createdAt: 9e15, state: "settled" }], deposits: [], unavailableIds: [] }, isPending: false };
  source.view.rerender(<QueryClientProvider client={source.client}><WalletActivity accountId="synthetic-wallet" /></QueryClientProvider>);
  expect(screen.getByTitle("Time unavailable")).toHaveTextContent("-");
  fireEvent.click(screen.getByRole("button", { name: /View (?:Send|Sent)/ }));
  const dialog = screen.getByRole("dialog", { name: "Transfer details" });
  expect(within(dialog).getByTitle("Time unavailable")).toHaveTextContent("-");
  expect(within(dialog).getByText(source.id)).toBeInTheDocument();
});

it("merges trades and individual funding routes with transfer activity and exposes exact estimates in details", () => {
  operationState.items = [
    { tradeSide: "buy", id: "trade:eth", title: "Bought ETH", time: Date.now() + 2000, asset: { assetId: "eth", symbol: "ETH", decimals: 18, blockchain: "eth", coingeckoId: "ethereum" }, amount: "0.000008", state: "settled", inputAmount: "0.02", inputSymbol: "USDC", minimum: "0.000007", hashes: [] },
    { tradeSide: undefined, id: "funding:batch:route", title: "Transfer to trading", time: Date.now() + 1000, asset: { assetId: "usdc", symbol: "USDC", decimals: 6, blockchain: "near", coingeckoId: "usd-coin" }, amount: "0.9997", state: "submitted", inputAmount: "1", inputSymbol: "USDC · base", minimum: "0.99", hashes: [] },
  ];
  mount("settled");
  const buttons = screen.getAllByRole("button", { name: /^View / });
  expect(buttons[0]).toHaveAccessibleName("View Bought ETH details");
  expect(buttons[1]).toHaveAccessibleName("View Transfer to trading details");
  expect(screen.getByText("≈ 0.000008 ETH")).toBeVisible();
  fireEvent.click(buttons[0]);
  const dialog = screen.getByRole("dialog", { name: "Bought ETH" });
  expect(within(dialog).getByText("0.02 USDC")).toBeVisible();
  expect(within(dialog).getByText("0.000008 ETH")).toBeVisible();
  expect(within(dialog).getByText("0.000007 ETH")).toBeVisible();
});
it("keeps deposits and withdrawals visible when operation history is unavailable", () => {
  operationState.error = true;
  mount("settled");
  expect(screen.getByRole("button", { name: /View (?:Send|Sent)/ })).toBeVisible();
  expect(screen.getByText("Some activity couldn’t be updated.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});

it("caps the home activity preview and links to the full page with incremental loading", () => {
  operationState.items = Array.from({ length: 21 }, (_, i) => ({ tradeSide: "buy", id: `trade:${i}`, time: Date.now() + i, title: `Bought TOKEN${i}`, asset: { assetId: `asset-${i}`, symbol: `TOKEN${i}`, decimals: 6, blockchain: "near" }, amount: "1", state: "settled", inputAmount: "1", inputSymbol: "USDC", minimum: "0.99", hashes: [] }));
  const preview = mount("settled", false, undefined, { limit: 5, href: "/activity" });
  expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(5);
  expect(screen.getByRole("link", { name: "View all activity" })).toHaveAttribute("href", "/activity");
  preview.view.unmount();
  mount("settled", false, undefined, { pageSize: 20 });
  expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(22);
});

it("labels local calendar days across month and year boundaries", () => {
  const now = new Date(2026, 0, 1, 12).getTime();
  expect(activityDay(new Date(2026, 0, 1, 1).getTime(), now).label).toBe("Today");
  expect(activityDay(new Date(2025, 11, 31, 23).getTime(), now).label).toBe("Yesterday");
  expect(activityDay(new Date(2025, 11, 30, 23).getTime(), now).label).toBe("30 December 2025");
  expect(activityDay(9e15, now).label).toBe("Date unavailable");
});
it("groups the full activity page by day and uses clock times inside each group", () => {
  const date = new Date(); date.setHours(9, 15, 0, 0);
  const yesterday = new Date(date); yesterday.setDate(yesterday.getDate() - 1);
  const base = { asset: { assetId: "eth", symbol: "ETH", decimals: 18, blockchain: "eth" }, amount: "0.1", state: "settled" as const, inputAmount: "1", inputSymbol: "USDC", minimum: "0.09", hashes: [] };
  operationState.items = [{ ...base, tradeSide: "buy", id: "today", title: "Bought ETH", time: date.getTime() }, { ...base, tradeSide: "buy", id: "yesterday", title: "Buy ETH yesterday", time: yesterday.getTime() }];
  mount("settled", false, undefined, { pageSize: 20, groupByDay: true });
  expect(screen.getByRole("heading", { name: "Today" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Yesterday" })).toBeVisible();
  for (const label of ["Today", "Yesterday"]) {
    expect(screen.getByRole("heading", { name: label }).closest('[data-slot="card"]')).toBeNull();
    expect(screen.getByRole("region", { name: label }).querySelectorAll('[data-slot="card"]')).toHaveLength(1);
  }
  expect(within(screen.getByRole("region", { name: "Today" })).getByText("09:15")).toBeVisible();
  expect(within(screen.getByRole("region", { name: "Yesterday" })).getByText("09:15")).toBeVisible();
});

it.each(["transfers", "operations"] as const)("shows only loading while %s is pending and the other history request failed", pending => {
  const source = mount("submitted");
  const refresh = () => source.view.rerender(<QueryClientProvider client={source.client}><WalletActivity accountId="synthetic-wallet" /></QueryClientProvider>);
  state.query = { isPending: pending === "transfers", isError: pending === "operations", refetch: vi.fn() };
  operationState.pending = pending === "operations";
  operationState.error = pending === "transfers";
  refresh();
  expect(screen.getByRole("status")).toHaveTextContent("Loading activity…");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
  state.query = { ...state.query, isPending: false };
  operationState.pending = false;
  refresh();
  expect(screen.queryByText("Loading activity…")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Activity unavailable");
  expect(screen.getByRole("button", { name: "Retry activity" })).toBeInTheDocument();
});

it.each(["transfers", "operations", "both"] as const)("keeps rows and offers one compact retry footer for %s failures", failed => {
  const source = mount("settled");
  const retry = vi.fn();
  state.query = { ...state.query, isError: failed !== "operations", refetch: retry };
  operationState.error = failed !== "transfers";
  source.view.rerender(<QueryClientProvider client={source.client}><WalletActivity accountId="synthetic-wallet" /></QueryClientProvider>);
  expect(screen.getByRole("button", { name: /View (?:Send|Sent)/ })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Some activity couldn’t be updated.");
  expect(screen.queryByText("Activity unavailable")).toBeNull();
  expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(operationState.refetch).toHaveBeenCalledOnce();
});
