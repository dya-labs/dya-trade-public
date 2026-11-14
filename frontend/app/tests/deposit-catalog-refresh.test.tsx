import { withTokenPolicy } from "./fixtures/token-policy";
import { approvedTestNetworks } from "./fixtures/network-policy";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LegacyDepositForm } from "@/components/near/transfers";
import { StandaloneWalletContext } from "@dya/wallet-ui/components/presentation";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import type { TrackedDepositQuote } from "@/lib/near/http/schemas/transfers";
import { prepareDeposit } from "@dya/wallet-ui/lib/near/http/transfers-client";

vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: async () => (withTokenPolicy({ networks: approvedTestNetworks, assets: [{ ...DEFAULT_PAIR.base, coingeckoId: "wrapped-near" }, { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" }] })) }));
vi.mock("@dya/wallet-ui/lib/near/http/transfers-client", () => ({ prepareDeposit: vi.fn() }));
vi.mock("@dya/wallet-ui/components/near/use-deposit-status", () => ({ useDepositStatus: () => ({ data: { status: "PENDING_DEPOSIT", terminal: false } }) }));
vi.mock("@dya/wallet-ui/components/near/asset-mark", () => ({ AssetMark: () => null }));
vi.mock("@dya/wallet-ui/components/near/network-mark", () => ({ NetworkMark: () => null }));
vi.mock("@dya/wallet-ui/lib/deposit-qr", () => ({ depositQrDataUrl: async () => "data:image/png;base64,dGVzdA==" }));
const clients: QueryClient[] = [];
beforeEach(() => { vi.stubGlobal("PointerEvent", MouseEvent); });
afterEach(() => { clients.splice(0).forEach(client => client.clear());vi.unstubAllGlobals();vi.clearAllMocks(); });
function setup(initialQuote?: TrackedDepositQuote) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });clients.push(client);
  render(<QueryClientProvider client={client}><StandaloneWalletContext.Provider value={true}><LegacyDepositForm accountId="deposit-catalog" initialQuote={initialQuote} /></StandaloneWalletContext.Provider></QueryClientProvider>);
  return client;
}
it.each(["removed", "empty"])("handles selected NEAR becoming %s from the catalog", async mode => {
  const client = setup();
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Deposit token" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Deposit token" }));
  fireEvent.click(screen.getByRole("button", { name: "NEAR" }));
  expect(screen.getByRole("button", { name: "Deposit token" })).toHaveTextContent("NEAR");
  await act(async () => { client.setQueryData(["near", "catalog"], withTokenPolicy({ networks: approvedTestNetworks, assets: mode === "empty" ? [] : [{ ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" }] })); });
  if (mode === "empty") {
    expect(await screen.findByText("Deposits temporarily unavailable")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Deposit token" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deposit network" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create deposit address" })).toBeNull();
    expect(prepareDeposit).not.toHaveBeenCalled();
    return;
  }
  await waitFor(() => expect(screen.getByRole("button", { name: "Deposit token" })).toHaveTextContent("Select token"));
  expect(screen.getByRole("button", { name: "Deposit token" })).not.toHaveTextContent("USDC");
  expect(screen.getByRole("button", { name: "Deposit network" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Create deposit address" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Deposit token" }));
  {
    fireEvent.click(screen.getByRole("button", { name: "USDC" }));
    expect(screen.getByRole("button", { name: "Deposit token" })).toHaveTextContent("USDC");
    expect(screen.getByRole("button", { name: "Deposit network" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create deposit address" })).toBeDisabled();
  }
  expect(prepareDeposit).not.toHaveBeenCalled();
});
it("keeps issued deposit instructions bound to their quote after catalog removal", async () => {
  const quote = { id: "issued", asset: "NEAR", sourceChain: "NEAR", sourceNetwork: "near", depositAddress: "issued-single-use-address", amountInFormatted: "1", deadline: new Date(Date.now() + 600000).toISOString() } as TrackedDepositQuote;
  const client = setup(quote);await screen.findByAltText("QR code for NEAR deposit on NEAR");
  await act(async () => { client.setQueryData(["near", "catalog"], withTokenPolicy({ networks: approvedTestNetworks, assets: [] })); });
  expect(screen.getByLabelText("issued-single-use-address")).toBeVisible();
  expect(screen.getByAltText("QR code for NEAR deposit on NEAR")).toBeVisible();
  expect(screen.getByRole("button", { name: "Copy address" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Deposit token" })).toBeNull();
  expect(prepareDeposit).not.toHaveBeenCalled();
});
