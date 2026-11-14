import { withTokenPolicy } from "./fixtures/token-policy";
import { approvedTestNetworks } from "./fixtures/network-policy";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { LegacyDepositForm } from "@/components/near/transfers";
import { StandaloneWalletContext } from "@dya/wallet-ui/components/presentation";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { prepareDeposit } from "@dya/wallet-ui/lib/near/http/transfers-client";
vi.mock("@dya/wallet-ui/components/near/network-mark", () => ({ NetworkMark: () => <span /> }));
vi.mock("@dya/wallet-ui/components/near/asset-mark", () => ({ AssetMark: () => <span /> }));
vi.mock("@dya/wallet-ui/components/near/use-deposit-status", () => ({ useDepositStatus: () => ({ data: null }) }));
vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: async () => (withTokenPolicy({ networks: approvedTestNetworks, assets: [{ ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" }] })) }));
vi.mock("@dya/wallet-ui/lib/near/http/transfers-client", () => ({ prepareDeposit: vi.fn() }));
const clients: QueryClient[] = [];
function mount() {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });clients.push(client);
  return render(<QueryClientProvider client={client}><StandaloneWalletContext.Provider value={true}><LegacyDepositForm accountId="wallet" /></StandaloneWalletContext.Provider></QueryClientProvider>);
}
afterEach(() => { cleanup();clients.splice(0).forEach(client => client.clear());vi.resetAllMocks();vi.unstubAllGlobals(); });
it("requires explicit acknowledgement of deposit conditions and disables Continue again when unchecked", () => {
  mount();
  expect(screen.getByText("Minimum deposit value $1 USD")).toBeVisible();
  expect(screen.getByText("Do not send a test deposit first")).toBeVisible();
  expect(screen.getByText("Do not reuse, save, whitelist, or share the address")).toBeVisible();
  const checkbox = screen.getByRole("checkbox", { name: /I understand this is a single-use address/ });
  const next = screen.getByRole("button", { name: "Continue" });expect(checkbox).not.toBeChecked();expect(next).toBeDisabled();
  fireEvent.click(next);expect(screen.queryByRole("button", { name: "Deposit network" })).not.toBeInTheDocument();
  fireEvent.click(checkbox);expect(checkbox).toBeChecked();expect(next).toBeEnabled();
  fireEvent.click(checkbox);expect(next).toBeDisabled();expect(prepareDeposit).not.toHaveBeenCalled();
});
it("acknowledgement opens configuration without creating a deposit address", async () => {
  mount();fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("button", { name: "Deposit network" })).toHaveTextContent("Select network");
  expect(screen.getByRole("button", { name: "Create deposit address" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Copy address" })).not.toBeInTheDocument();expect(prepareDeposit).not.toHaveBeenCalled();
});
it("a newly opened deposit form requires acknowledgement again", () => {
  const view = mount();fireEvent.click(screen.getByRole("checkbox"));expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  view.unmount();mount();
  expect(screen.getByRole("checkbox")).not.toBeChecked();expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();expect(prepareDeposit).not.toHaveBeenCalled();
});
