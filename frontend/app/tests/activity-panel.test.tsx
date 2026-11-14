import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { ActivityPanel, type ActivityTab } from "@/components/near/activity-panel";
import { DEFAULT_PAIR, type SelectedPair } from "@/lib/near/domain/catalog";
import type { StoredOrder, Trade } from "@/lib/near/http/schemas/trading";
import { getOrders, setOrdersState } from "@/stories/orders/api-mocks";
import { fixtures, setTradesState } from "@/stories/trades/api-mocks";
const state = vi.hoisted(() => ({ orders: [] as StoredOrder[], trades: [] as Trade[], refresh: vi.fn(), cancel: vi.fn() }));
vi.mock("@/components/near/use-activity", () => ({
  useOrders: (account: string | null) => ({ data: account === "alice" ? state.orders : [], isSuccess: true, refetch: state.refresh }),
  useMarketTrades: (account: string | null) => ({ data: account === "alice" ? state.trades : [], isSuccess: true, refetch: state.refresh }),
}));
vi.mock("@/lib/near/http/trading-client", () => ({ cancelOrder: (...args: unknown[]) => state.cancel(...args) }));
vi.mock("@/components/near/balances", () => ({ Balances: () => <p>Account-wide balances</p> }));
vi.mock("@/components/near/transfer-activity", () => ({ TransferActivity: () => <p>Account-wide transfers</p> }));
vi.mock("@/components/near/intents-trades", () => ({ IntentsTrades: () => <p>Selected-market public trades</p> }));
function Panel({ account = "alice", pair = DEFAULT_PAIR }: { account?: string; pair?: SelectedPair }) {
  const [value, change] = useState<ActivityTab>("orders");
  return <ActivityPanel accountId={account} pair={pair} marketId="public" value={value} onChange={change} openTransfers={vi.fn()} openDeposit={vi.fn()} />;
}
function mount(pair?: SelectedPair) { const client = new QueryClient(); return render(<QueryClientProvider client={client}><Panel pair={pair} /></QueryClientProvider>); }
beforeEach(async () => { vi.clearAllMocks(); setOrdersState("Mixed"); state.orders = (await getOrders()).orders; setTradesState("Mixed"); state.trades = fixtures(); });
it("counts only actionable orders and separates history from active cancellation controls", () => {
  mount();
  expect(screen.getByRole("tab", { name: "Open orders (3)" })).toBeVisible();
  expect(within(screen.getByRole("table", { name: "Open orders" })).getAllByRole("row")).toHaveLength(4);
  fireEvent.click(screen.getByRole("tab", { name: "Order history" }));
  expect(within(screen.getByRole("table", { name: "Order history" })).getAllByRole("row")).toHaveLength(9);
  expect(screen.getByText("Failed")).toBeVisible();
  expect(screen.getByText("Cancelled")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Cancel buy/ })).toBeNull();
});
it("filters personal rows by exact current-market asset identity", async () => {
  mount({ ...DEFAULT_PAIR, base: { ...DEFAULT_PAIR.base, assetId: "different-network-token", symbol: "BTC" } });
  expect(screen.getByRole("tab", { name: "Open orders (3)" })).toBeVisible();
  fireEvent.click(screen.getByRole("combobox", { name: "Market filter" }));
  const option = await screen.findByRole("option", { name: "Current market (BTC/USDC)" });
  fireEvent.pointerDown(option, { button: 0 });
  fireEvent.click(option, { detail: 1 });
  await waitFor(() => expect(screen.getByText("No open orders.")).toBeVisible());
  fireEvent.click(screen.getByRole("tab", { name: "Order history" }));
  expect(screen.getByText("No submitted orders yet.")).toBeVisible();
});
it("shows fills in trade history and never converts quoted legacy amounts into executions", () => {
  mount();
  fireEvent.click(screen.getByRole("tab", { name: "Trade history" }));
  expect(within(screen.getByRole("table", { name: "Trade history" })).getAllByRole("row")).toHaveLength(4);
  expect(screen.getByText("Amounts unavailable")).toBeVisible();
  const legacy = screen.getByRole("row", { name: "View market buy NEAR execution" });
  fireEvent.keyDown(legacy, { key: "Enter" });
  expect(screen.getByRole("dialog", { name: "Bought NEAR" })).toHaveTextContent("Actual amounts are unavailable");
  expect(state.cancel).not.toHaveBeenCalled();
});
it("keeps public and account-wide scopes explicit", () => {
  mount();
  fireEvent.click(screen.getByRole("tab", { name: "Transfers" }));
  expect(screen.getByText("All assets and networks")).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "Market filter" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Market trades" }));
  expect(screen.getByText(/Public NEAR Intents swaps · excludes confidential trades/)).toBeVisible();
});
it("does not retain personal rows or details after switching accounts", () => {
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}><Panel account="alice" /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("row", { name: "View buy NEAR order details" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  view.rerender(<QueryClientProvider client={client}><Panel account="bob" /></QueryClientProvider>);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("No open orders.")).toBeVisible();
});

it("uses the same limit detail presentation in open orders and history, with a single working header Close action", () => {
  mount();
  fireEvent.click(screen.getByRole("row", { name: "View buy NEAR order details" }));
  let dialog = screen.getByRole("dialog", { name: "Limit buy · Open" });
  expect(dialog).toHaveTextContent("Limit price");
  expect(dialog).toHaveTextContent("Remaining");
  expect(within(dialog).getAllByRole("button", { name: "Close" })).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Order history" }));
  fireEvent.click(screen.getAllByRole("row", { name: "View limit buy order history details" })[0]);
  dialog = screen.getByRole("dialog", { name: "Limit buy · Open" });
  expect(dialog).toHaveTextContent("Remaining");
  expect(state.cancel).not.toHaveBeenCalled();
});

it("moves a processing market trade from Open orders to Trade history once settled", () => {
  state.orders = [];
  setTradesState("Processing"); state.trades = fixtures();
  const view = mount();
  expect(screen.getByRole("tab", { name: "Open orders (1)" })).toBeVisible();
  const row = screen.getByRole("row", { name: /View market sell|View market buy/ });
  expect(within(row).getByRole("status")).toHaveTextContent("Processing");
  expect(within(row).queryByRole("button", { name: /cancel/i })).toBeNull();
  expect(row.querySelector("svg")).toBeTruthy();
  state.trades = state.trades.map(trade => ({ ...trade, state: "settled" }));
  view.rerender(<QueryClientProvider client={new QueryClient()}><Panel /></QueryClientProvider>);
  expect(screen.getByText("No open orders.")).toBeVisible();
  expect(screen.queryByText("Processing")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Trade history" }));
  expect(within(screen.getByRole("table", { name: "Trade history" })).getAllByRole("row")).toHaveLength(2);
});

it("places balances first and keeps them account-wide", () => {
 mount();
 expect(screen.getAllByRole("tab")[0]).toHaveTextContent("Balances");
 fireEvent.click(screen.getByRole("tab", { name: "Balances" }));
 expect(screen.getByText("Account-wide balances")).toBeVisible();
 expect(screen.getByText("All assets")).toBeVisible();
 expect(screen.queryByRole("combobox", { name: "Market filter" })).toBeNull();
});
