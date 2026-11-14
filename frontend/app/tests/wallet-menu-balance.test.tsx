vi.mock("@/lib/near/http/trading-client", () => ({ getMarketTrades: async () => ({ trades: [] }) }));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WalletMenu } from "@/components/near/wallet-menu";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";

const state = vi.hoisted(() => ({ amount: undefined as string | undefined }));
vi.mock("@/components/near/use-live-balances", () => ({ useBalanceQuery: () => ({ data: { assets: state.amount === undefined ? [] : [{ ...DEFAULT_PAIR.quote, amount: state.amount, raw: state.amount === "0" ? "0" : "12340000" }] }, error: null }) }));
vi.mock("@dya/wallet-ui/hooks/use-wallet-queries", () => ({ useCatalogQuery: () => ({ data: { assets: [DEFAULT_PAIR.quote] }, error: null }) }));
vi.mock("@/lib/near/http/catalog-client", () => ({ getTokenMarkets: async () => ({ assets: {} }) }));
vi.mock("@/lib/near/http/funding-conversions-client", () => ({ fundingHistory: async () => ({ operations: [] }) }));
vi.mock("@/lib/near/http/transfers-client", () => ({ getWithdrawals: async () => ({ withdrawals: [] }), getDeposits: async () => ({ deposits: [] }), getBridgeDeposits: async () => ({ deposits: [] }) }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });
it.each([
  { name: "missing", amount: undefined, label: "USDC trading balance unavailable", text: "-" },
  { name: "zero", amount: "0", label: "0 USDC trading balance", text: "$0.00" },
  { name: "positive", amount: "12.34", label: "12.34 USDC trading balance", text: "$12.34" },
])("shows a truthful $name trading balance in the wallet summary", async ({ amount, label, text }) => {
  state.amount = amount;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><WalletMenu account={{ id: "synthetic-account", kind: "passkey" }} onDeposit={() => {}} onWithdraw={() => {}} onFunding={() => {}} onSignOut={() => {}} onActivity={() => {}} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Open wallet" }));
  expect(await screen.findByLabelText(label)).toHaveTextContent(text);
});

it("offers only Deposit after confirming a wallet has no assets or history", async () => {
  state.amount = "0";
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const onDeposit = vi.fn();
  render(<QueryClientProvider client={client}><WalletMenu account={{ id: "new-account", kind: "passkey" }} onDeposit={onDeposit} onWithdraw={() => {}} onFunding={() => {}} onSignOut={() => {}} onActivity={() => {}} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Open wallet" }));
  expect(await screen.findByText("Add funds to get started")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Assets" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
  expect(onDeposit).toHaveBeenCalledOnce();
});
