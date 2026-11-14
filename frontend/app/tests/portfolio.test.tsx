import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Balances } from "@/components/near/balances";
import { Portfolio } from "@/components/near/portfolio";
import { TooltipProvider } from "@dya/ui/components/tooltip";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { ConfidentialAccessRequired } from "@/lib/near/domain/confidential-access-error";
const state = vi.hoisted(() => ({ balances: { data: undefined as unknown, error: null as unknown, isPending: false, refetch: vi.fn() }, orders: { data: [] as unknown[], error: null, isPending: false, refetch: vi.fn() } }));
vi.mock("@/components/near/use-live-balances", () => ({ useBalanceQuery: () => state.balances }));
vi.mock("@/components/near/use-activity", () => ({ useOrders: () => state.orders }));
vi.mock("@dya/wallet-ui/hooks/use-wallet-queries", () => ({ useCatalogQuery: () => ({ data: { assets: [DEFAULT_PAIR.quote] }, isPending: false, refetch: vi.fn() }) }));
vi.mock("@/lib/near/http/catalog-client", () => ({ getTokenMarkets: async () => ({ updatedAt: Date.now(), assets: {} }) }));
vi.mock("@/components/near/asset-mark", () => ({ AssetMark: () => null }));
vi.mock("@/components/near/confidential-access", () => ({ ConfidentialAccess: () => <p>Unlock confidential balances</p> }));
function mount(accountId: string | null = "alice", updatedAt = Date.now(), balancesActivity = false) {
 const client = new QueryClient();
 client.setQueryData(["near", "token-markets"], { updatedAt, assets: { [DEFAULT_PAIR.quote.assetId]: { price: 1 } } });
 return render(<QueryClientProvider client={client}><TooltipProvider><Portfolio accountId={accountId} loading={false} busy={false} connect={vi.fn()} deposit={vi.fn()} withdraw={vi.fn()} activity={balancesActivity ? <Balances accountId={accountId} showDataWarning={false} /> : <p>Account activity</p>} /></TooltipProvider></QueryClientProvider>);
}
afterEach(() => { cleanup(); state.balances.data = undefined; state.balances.error = null; state.orders.data = []; });
it("shows portfolio summaries and shared activity without a duplicate holdings card", () => {
 state.balances.data = { accountId: "alice", assets: [{ ...DEFAULT_PAIR.quote, amount: "10", raw: "10000000" }] };
 mount();
 expect(screen.getByText("Portfolio value")).toBeVisible();
 expect(screen.getByText("In wallet")).toBeVisible();
 expect(screen.getByText("In open orders")).toBeVisible();
 expect(screen.queryByText("Holdings")).toBeNull();
 expect(screen.queryByRole("table", { name: "Portfolio holdings" })).toBeNull();
 expect(screen.getByText("Account activity")).toBeVisible();
 expect(screen.getByRole("button", { name: "Deposit" })).toBeEnabled();
});
it("offers wallet connection without displaying private balances when signed out", () => {
 mount(null);
 expect(screen.getByRole("button", { name: "Connect wallet" })).toBeVisible();
 expect(screen.queryByRole("table")).toBeNull();
 expect(screen.queryByText("Account activity")).toBeNull();
});
it("hides retained balances when confidential access requires confirmation", () => {
 state.balances.data = { assets: [{ ...DEFAULT_PAIR.quote, amount: "12345", raw: "12345000000" }] };
 state.balances.error = new ConfidentialAccessRequired("Unlock");
 mount();
 expect(screen.getByText("Unlock confidential balances")).toBeVisible();
 expect(screen.queryByRole("table")).toBeNull();
 expect(screen.queryByText(/12,345/)).toBeNull();
});

it("offers value help instead of a permanent explanatory paragraph", () => {
 state.balances.data = { accountId: "alice", assets: [] };
 mount();
 expect(screen.queryByText(/Wallet balances and confirmed funds/)).toBeNull();
 expect(screen.getByRole("button", { name: "About portfolio value" })).toBeVisible();
 expect(screen.queryByRole("status")).toBeNull();
});
it("shows a price notice only when the metadata is delayed", () => {
 state.balances.data = { accountId: "alice", assets: [] };
 mount("alice", Date.now() - 21 * 60_000);
 expect(screen.getByRole("status")).toHaveTextContent("Market prices are delayed.");
});

it("shows a settlement notice only while reconciliation is pending", () => {
 state.balances.data = { accountId: "alice", assets: [] };
 state.orders.data = [{ state: "unknown", fundingState: "unknown" }];
 mount();
 expect(screen.getByRole("status")).toHaveTextContent("Some funds are awaiting settlement");
});

function mountBalances(accountId: string | null = "alice") {
 const client = new QueryClient();
 client.setQueryData(["near", "token-markets"], { updatedAt: Date.now(), assets: { [DEFAULT_PAIR.quote.assetId]: { price: 1 } } });
 return render(<QueryClientProvider client={client}><TooltipProvider><Balances accountId={accountId} /></TooltipProvider></QueryClientProvider>);
}
it("reuses portfolio accounting in balances without allocation or P&L", () => {
 state.balances.data = { assets: [{ ...DEFAULT_PAIR.quote, amount: "10", raw: "10000000" }] };
 mountBalances();
 const table = screen.getByRole("table", { name: "Balances" });
 expect(table).toHaveTextContent("USDC");
 expect(table).toHaveTextContent("10.00");
 expect(table).toHaveTextContent("$10.00");
 expect(table).toHaveTextContent("In orders");
 expect(table).not.toHaveTextContent("Allocation");
 expect(table).not.toHaveTextContent("PNL");
});
it("hides balances when signed out or confidential access is locked", () => {
 state.balances.data = { assets: [{ ...DEFAULT_PAIR.quote, amount: "12345", raw: "12345000000" }] };
 const view = mountBalances(null);
 expect(screen.queryByRole("table")).toBeNull();
 view.unmount();
 state.balances.error = new ConfidentialAccessRequired("Unlock");
 mountBalances();
 expect(screen.getByText("Unlock confidential balances")).toBeVisible();
 expect(screen.queryByText(/12,345/)).toBeNull();
});
it("keeps table headers visible and uses five uniform loading cells per row", () => {
 state.balances.isPending = true;
 const view = mountBalances();
 const table = screen.getByRole("table", { name: "Balances" });
 expect(table).toHaveAttribute("aria-busy", "true");
 expect(table).toHaveTextContent("Available");
 expect(table.querySelectorAll("tbody tr")).toHaveLength(3);
 expect(table.querySelectorAll("tbody td")).toHaveLength(15);
 view.unmount();
 state.balances.isPending = false;
});
it("keeps last known amounts visible when balance refresh fails", () => {
 state.balances.data = { assets: [{ ...DEFAULT_PAIR.quote, amount: "10", raw: "10000000" }] };
 state.balances.error = new Error("offline");
 mountBalances();
 expect(screen.getByRole("table", { name: "Balances" })).toHaveTextContent("$10.00");
 expect(screen.getByText("Updates delayed")).toBeVisible();
 expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
 expect(screen.queryByText(/Partial valuation/)).toBeNull();
});

it("shows one delayed warning on Portfolio while keeping standalone balances recoverable", () => {
 state.balances.data = { assets: [{ ...DEFAULT_PAIR.quote, amount: "10", raw: "10000000" }] };
 state.balances.error = new Error("offline");
 mount("alice", Date.now(), true);
 expect(screen.getAllByText("Updates delayed · Showing last known balances")).toHaveLength(1);
 expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
 fireEvent.click(screen.getByRole("button", { name: "Retry" }));
 expect(state.balances.refetch).toHaveBeenCalled();
 expect(screen.queryByRole("alert")).toBeNull();
});
it("keeps a stronger recoverable alert when portfolio data is unavailable", () => {
 state.balances.error = new Error("offline");
 mount("alice", Date.now(), true);
 expect(screen.getAllByRole("alert")).toHaveLength(1);
 expect(screen.getByRole("alert")).toHaveTextContent("Portfolio data is unavailable.");
 expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
});

it("shows one centered recovery state without duplicate alerts or valuation notes", () => {
 state.balances.error = new Error("offline");
 mountBalances();
 expect(screen.getByText("Couldn’t load balances")).toBeVisible();
 expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
 expect(screen.queryByRole("alert")).toBeNull();
 expect(screen.queryByRole("table")).toBeNull();
 expect(screen.queryByText(/Partial valuation/)).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "Retry" }));
 expect(state.balances.refetch).toHaveBeenCalled();
 expect(state.orders.refetch).toHaveBeenCalled();
});
