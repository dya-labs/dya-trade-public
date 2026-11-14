import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";
import { WalletAssets } from "@dya/wallet-ui/components/wallet-assets";
import { groupedHoldings, groupedCatalog } from "./fixtures/wallet-assets";
const clients: QueryClient[] = [];
function view(holdings = groupedHoldings, catalog = groupedCatalog, options: { limit?: number; pageSize?: number } = {}) {
  const client = new QueryClient(); clients.push(client); client.setQueryData(["near", "token-icons"], { icons: {} });
  return render(<QueryClientProvider client={client}><WalletAssets holdings={holdings} catalog={catalog} {...options} /></QueryClientProvider>);
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });
it("shows formatted grouped balance, expands network holdings and collapses via the full row", () => {
  view();
  const expand = screen.getByRole("button", { name: "Expand USDC networks" });
  expect(expand).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("0.30")).toBeInTheDocument();
  expect(screen.getByRole("table")).toHaveTextContent("2");
  fireEvent.click(expand);
  expect(screen.getByRole("button", { name: "Collapse USDC networks" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("NEAR")).toBeInTheDocument();
  expect(screen.getByText("Base")).toBeInTheDocument();
  expect(screen.getByText("0.10")).toBeInTheDocument();
  expect(screen.getByText("0.20")).toBeInTheDocument();
  fireEvent.click(screen.getByText("0.30").closest("tr")!);
  expect(screen.queryByText("Base")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Expand USDC networks" })).toHaveAttribute("aria-expanded", "false");
});
it("keeps a same-ticker holding separate when catalog identity is missing", () => {
  view([...groupedHoldings, { ...groupedHoldings[0], assetId: "unlisted", amount: "9", raw: "9000000" }]);
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
  expect(screen.getByText("0.30")).toBeInTheDocument();
  expect(screen.getByText("9.00")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "USDC on unknown network" })).toBeInTheDocument();
});

it("caps home token groups at five and reveals more on the full assets page", () => {
  const holdings = Array.from({ length: 21 }, (_, i) => ({ ...groupedHoldings[0], assetId: `asset-${i}`, symbol: `TOKEN${i}` }));
  const preview = view(holdings, [], { limit: 5 });
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(5);
  preview.unmount();
  view(holdings, [], { pageSize: 20 });
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(21);
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});
