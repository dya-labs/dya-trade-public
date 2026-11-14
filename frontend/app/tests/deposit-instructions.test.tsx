import { withTokenPolicy } from "./fixtures/token-policy";
import { approvedTestNetworks } from "./fixtures/network-policy";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { DialogDrawer, DialogDrawerContent } from "@dya/ui/components/dialog-drawer";
import type { TrackedDepositQuote } from "@dya/wallet-ui/lib/near/http/schemas/transfers";
import { LegacyDepositForm } from "@/components/near/transfers";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
const mocks = vi.hoisted(() => ({ address: vi.fn(), prepare: vi.fn(), qr: vi.fn(async () => "data:image/png;base64,dGVzdA==") }));
vi.mock("@dya/wallet-ui/components/near/network-mark", () => ({ NetworkMark: () => <span /> }));
vi.mock("@dya/wallet-ui/components/near/asset-mark", () => ({ AssetMark: () => <span /> }));
vi.mock("@dya/wallet-ui/lib/deposit-qr", () => ({ depositQrDataUrl: mocks.qr }));
vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: async () => (withTokenPolicy({ networks: approvedTestNetworks, assets: [{ ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" }, { ...DEFAULT_PAIR.quote, assetId: "base-usdc", blockchain: "base", coingeckoId: "usd-coin" }] })) }));
vi.mock("@dya/wallet-ui/lib/near/http/transfers-client", () => ({
  getBridgeRoutes: async () => ({ routes: [{ asset: DEFAULT_PAIR.quote, chain: "near:mainnet", minimum: "100000" }] }),
  getBridgeAddress: mocks.address,
  prepareDeposit: mocks.prepare,
  getDepositStatus: async () => ({ providerStatus: "PENDING_DEPOSIT" }),
  getBridgeDeposits: async () => ({ deposits: [] }),
}));
it("opens deposit instructions directly without amount or refund fields", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  mocks.prepare.mockResolvedValue({ id: "quote", depositAddress: "0x123", asset: "USDC", sourceChain: "Base", minAmountInFormatted: "0.15", showDollarBuffer: true, deadline: new Date(Date.now() + 600000).toISOString() });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><DialogDrawer open><DialogDrawerContent><LegacyDepositForm accountId="test" /></DialogDrawerContent></DialogDrawer></QueryClientProvider>);
  expect((await screen.findByRole("button", { name: "Continue" })).hasAttribute("disabled")).toBe(true);
  expect(mocks.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Deposit network" }).hasAttribute("disabled")).toBe(false));
  expect(screen.getByRole("button", { name: "Create deposit address" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Deposit network" }));
  fireEvent.click(screen.getByRole("button", { name: "Base" }));
  fireEvent.click(screen.getByRole("button", { name: "Create deposit address" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy());
  expect(mocks.prepare).toHaveBeenCalledWith({ sourceAssetId: "base-usdc", targetAssetId: "base-usdc" });
  expect(screen.queryByRole("textbox", { name: /Amount/ })).toBeNull();
  expect(screen.queryByText(/Refund address/i)).toBeNull();
  expect(screen.getByText(/Send at least 1 USDC/)).toBeTruthy();
  expect(await screen.findByAltText(/QR code/)).toBeTruthy();
  expect(mocks.address).not.toHaveBeenCalled();

});
it("hides deposit networks whose server-provided availability is disabled", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["near", "catalog"], withTokenPolicy({ networks: approvedTestNetworks.map(n => ({ ...n, deposits: false })), assets: [{ ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" }] }));
  // A server-side catalog test covers the policy projection; the picker consumes the projected capability.
  render(<QueryClientProvider client={client}><DialogDrawer open><DialogDrawerContent><LegacyDepositForm accountId="test" /></DialogDrawerContent></DialogDrawer></QueryClientProvider>);
  expect(await screen.findByText("Deposits temporarily unavailable")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Deposit network" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Deposit token" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Create deposit address" })).toBeNull();
  expect(screen.queryByRole("list", { name: "Deposit steps" })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
});
it("shows one ZEC row and retains its network choices", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const zec = { ...DEFAULT_PAIR.quote, symbol: "ZEC", coingeckoId: "zcash", assetId: "zec-base", blockchain: "base" };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["near", "catalog"], withTokenPolicy({ networks: approvedTestNetworks, assets: [
    zec, { ...zec, assetId: "zec-eth", blockchain: "eth" }, { ...zec, assetId: "zec-bsc", blockchain: "bsc" },
  ] }));
  render(<QueryClientProvider client={client}><DialogDrawer open><DialogDrawerContent><LegacyDepositForm accountId="test" /></DialogDrawerContent></DialogDrawer></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Deposit token" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search tokens" }), { target: { value: "zec" } });
  expect(screen.getAllByRole("button", { name: "ZEC" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "ZEC" }));
  fireEvent.click(screen.getByRole("button", { name: "Deposit network" }));
  expect(screen.getByRole("button", { name: "Base" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ethereum" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "BNB Smart Chain" })).toBeTruthy();
});
it("omits tokens with no approved enabled deposit source", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const asset = (symbol: string, blockchain: string) => ({ ...DEFAULT_PAIR.quote, symbol, blockchain, coingeckoId: symbol.toLowerCase(), assetId: `${blockchain}-${symbol}` });
  const assets = [asset("AVAILABLE", "base"), asset("DISABLED", "eth"), asset("UNREVIEWED", "sol"), asset("UNKNOWN", "missing"), asset("TOKENOFF", "base")];
  const catalog = withTokenPolicy({ networks: approvedTestNetworks.map(n => n.id === "eth" ? { ...n, deposits: false } : n.id === "sol" ? { ...n, status: "needs_review" as const } : n), assets });
  catalog.tokens = catalog.tokens.map(t => t.id === "base-TOKENOFF" ? { ...t, deposits: false } : t);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["near", "catalog"], catalog);
  render(<QueryClientProvider client={client}><DialogDrawer open><DialogDrawerContent><LegacyDepositForm accountId="test" /></DialogDrawerContent></DialogDrawer></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Deposit token" }));
  expect(screen.getByRole("button", { name: "AVAILABLE" })).toBeTruthy();
  for (const name of ["DISABLED", "UNREVIEWED", "UNKNOWN", "TOKENOFF"]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
});


it("reserves the QR area while generating and keeps the address available on failure", async () => {
  const pending = Promise.withResolvers<string>();
  mocks.qr.mockReturnValueOnce(pending.promise);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><DialogDrawer open><DialogDrawerContent><LegacyDepositForm accountId="qr-preview" initialQuote={{ id: "qr-quote", depositAddress: "0x123", asset: "USDC", sourceChain: "Base", deadline: new Date(Date.now() + 600000).toISOString() } as TrackedDepositQuote} /></DialogDrawerContent></DialogDrawer></QueryClientProvider>);
  expect(await screen.findByText("Preparing QR code…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Copy address" })).toBeEnabled();
  pending.reject(new Error("QR generation failed"));
  expect(await screen.findByText("QR code unavailable. Copy the address below.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Copy address" })).toBeEnabled();
  client.clear();
});
