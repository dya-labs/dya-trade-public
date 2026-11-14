import { withTokenPolicy } from "./fixtures/token-policy";
import { approvedTestNetworks } from "./fixtures/network-policy";
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { WithdrawalForm } from "@/components/near/withdrawal-form";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { getCatalog } from "@dya/wallet-ui/lib/near/http/catalog-client";
import { prepareWithdrawal, submitWithdrawal } from "@dya/wallet-ui/lib/near/http/transfers-client";
vi.mock("@dya/wallet-ui/lib/near/http/transfers-client", () => ({ prepareWithdrawal: vi.fn(), submitWithdrawal: vi.fn(), getWithdrawalStatus: vi.fn() }));
vi.mock("@dya/ui/components/dialog-drawer", async () => {
  const { DialogHeader } = await import("@dya/ui/components/dialog");
  return { DialogDrawerHeader: DialogHeader, DialogDrawerTitle: "h2", DialogDrawerDescription: "p" };
});
vi.mock("@dya/wallet-ui/components/near/asset-mark", () => ({ AssetMark: () => null }));
vi.mock("@dya/wallet-ui/components/near/network-mark", () => ({ NetworkMark: () => null }));
vi.mock("@dya/wallet-ui/components/near/use-live-balances", () => ({ useBalanceQuery: () => ({ data: { assets: [{ ...DEFAULT_PAIR.quote, amount: "2.803025", raw: "2803025" }] } }) }));
vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: vi.fn() }));
it("starts with USDC and no network, then separates recipient and amount screens", async () => {
  const origin = { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" };
  vi.mocked(getCatalog).mockResolvedValue(withTokenPolicy({ networks: approvedTestNetworks, assets: [origin, { ...origin, assetId: "base-usdc", blockchain: "base" }] }));
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}><WithdrawalForm accountId="account" /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Withdrawal token" })).toHaveTextContent("USDC"));
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(screen.queryByLabelText("Amount (USDC)")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Withdrawal network" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search networks" }), { target: { value: "Base" } });
  fireEvent.click(screen.getByRole("button", { name: "Base" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByLabelText("Address on Base")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Address on Base" })).toBeVisible();
  expect(screen.queryByLabelText("Amount (USDC)")).toBeNull();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: "0x1234567890123456789012345678901234567890" } });
  fireEvent.click(screen.getByRole("button", { name: "Select recipient 0x1234567890123456789012345678901234567890" }));
  expect(screen.getByRole("heading", { name: "Enter amount" })).toBeVisible();
  expect(screen.queryByLabelText("Address on Base")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Max" }));
  expect(screen.getByLabelText("Amount (USDC)")).toHaveValue("2.803025");
  fireEvent.click(screen.getByRole("button", { name: "Back to recipient" }));
  expect(screen.getByLabelText("Address on Base")).toHaveValue("0x1234567890123456789012345678901234567890");
  fireEvent.click(screen.getByRole("button", { name: "Back to token and network" }));
  expect(screen.getByRole("button", { name: "Withdrawal network" })).toHaveTextContent("Base");
  view.unmount(); client.clear();
});

it("uses injected authentication and prevents resubmission after a lost response", async () => {
  const authenticate = vi.fn().mockResolvedValue({ id: "assertion" });
  vi.mocked(prepareWithdrawal).mockResolvedValue({ options: {}, review: { amount: "1", expectedReceive: "1", minimumReceive: "0.99", asset: "USDC", destinationChain: "Base", destinationWallet: "receiver", deadline: new Date(Date.now() + 60000).toISOString() } } as Awaited<ReturnType<typeof prepareWithdrawal>>);
  vi.mocked(submitWithdrawal).mockRejectedValue(new Error("Connection lost"));
  const origin = { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" };
  vi.mocked(getCatalog).mockResolvedValue(withTokenPolicy({ networks: approvedTestNetworks, assets: [origin, { ...origin, assetId: "base-usdc", blockchain: "base" }] }));
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}><WithdrawalForm accountId="account" authenticate={authenticate} /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Withdrawal token" })).toHaveTextContent("USDC"));
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(screen.queryByLabelText("Amount (USDC)")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Withdrawal network" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search networks" }), { target: { value: "Base" } });
  fireEvent.click(screen.getByRole("button", { name: "Base" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByLabelText("Address on Base")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Address on Base" })).toBeVisible();
  expect(screen.queryByLabelText("Amount (USDC)")).toBeNull();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: "0x1234567890123456789012345678901234567890" } });
  fireEvent.click(screen.getByRole("button", { name: "Select recipient 0x1234567890123456789012345678901234567890" }));
  expect(screen.getByRole("heading", { name: "Enter amount" })).toBeVisible();
  expect(screen.queryByLabelText("Address on Base")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Max" }));
  expect(screen.getByLabelText("Amount (USDC)")).toHaveValue("2.803025");
  fireEvent.click(screen.getByRole("button", { name: "Review withdrawal" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm withdrawal" }));
  expect(await screen.findByText(/outcome is unconfirmed/)).toBeVisible();
  expect(authenticate).toHaveBeenCalledTimes(1);
  expect(submitWithdrawal).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Confirm withdrawal" })).toBeNull();
  view.unmount(); client.clear();
});
it.each(["missing", "pending", "disabled"] as const)("keeps %s network policies out of withdrawal choices without hiding the token", async status => {
  const origin = { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" };
  const networks = status === "missing" ? undefined : approvedTestNetworks.map(n => n.id === "base" ? { ...n, status, withdrawals: false } : n);
  vi.mocked(getCatalog).mockResolvedValue(withTokenPolicy({ networks, assets: [origin, { ...origin, assetId: "base-usdc", blockchain: "base" }] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><WithdrawalForm accountId="account" /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Withdrawal token" })).toHaveTextContent("USDC"));
  fireEvent.click(screen.getByRole("button", { name: "Withdrawal network" }));
  expect(screen.queryByRole("button", { name: /^Base$/ })).toBeNull();
  view.unmount(); client.clear();
});

it("groups withdrawal tokens while retaining distinct destination networks", async () => {
  const zec = { ...DEFAULT_PAIR.quote, symbol: "ZEC", coingeckoId: "zcash", assetId: "zec-base", blockchain: "base" };
  const other = { ...zec, symbol: "OTHER", assetId: "other", coingeckoId: "other" };
  vi.mocked(getCatalog).mockResolvedValue(withTokenPolicy({ networks: approvedTestNetworks, assets: [
    zec, { ...zec, assetId: "zec-eth", blockchain: "eth" }, { ...zec, assetId: "zec-sol", blockchain: "sol" }, other,
  ] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><WithdrawalForm accountId="account" /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Withdrawal token" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Withdrawal token" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search tokens" }), { target: { value: "zec" } });
  expect(screen.getAllByRole("button", { name: "ZEC" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "ZEC" }));
  fireEvent.click(screen.getByRole("button", { name: "Withdrawal network" }));
  expect(screen.getByRole("button", { name: "Base" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ethereum" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Solana" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Ethereum" }));
  expect(screen.getByRole("button", { name: "Withdrawal network" })).toHaveTextContent("Ethereum");
  view.unmount(); client.clear();
});

it("reviews a Trading estimate from the selected wallet without prompting for a passkey", async () => {
  const asset = { ...DEFAULT_PAIR.quote, assetId: "base-usdc", blockchain: "base", coingeckoId: "usd-coin" };
  vi.mocked(getCatalog).mockResolvedValue(withTokenPolicy({ networks: approvedTestNetworks, assets: [asset] }));
  const recipient = "0x1234567890123456789012345678901234567890";
  const authenticate = vi.fn();
  const submit = vi.fn();
  const prepare = vi.fn().mockResolvedValue({
    review: { amount: "2", asset: "USDC", expectedReceive: "1.75", destinationWallet: recipient, deadline: new Date(Date.now() + 60000).toISOString() },
  });
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}><WithdrawalForm accountId="trading-wallet" authenticate={authenticate}
    withdrawalSource={{
      assetId: asset.assetId, prepare, submit, status: vi.fn(), onUpdated: vi.fn(),
      balances: { data: { assets: [{ ...asset, amount: "2", raw: "2000000" }] }, error: null, isFetching: false, isPending: false, refetch: vi.fn() },
    }} /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Withdrawal token" })).toHaveTextContent("USDC"));
  fireEvent.click(screen.getByRole("button", { name: "Withdrawal network" }));
  fireEvent.click(screen.getByRole("button", { name: "Base" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: recipient } });
  fireEvent.click(screen.getByRole("button", { name: `Select recipient ${recipient}` }));
  fireEvent.click(screen.getByRole("button", { name: "Max" }));
  fireEvent.click(screen.getByRole("button", { name: "Review withdrawal" }));
  expect(await screen.findByRole("button", { name: "Withdrawal unavailable" })).toBeDisabled();
  expect(screen.queryByText("Minimum received")).toBeNull();
  expect(prepare).toHaveBeenCalledWith({ originAssetId: asset.assetId, destinationAssetId: asset.assetId, wallet: recipient, amount: "2" });
  expect(authenticate).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  view.unmount();
  client.clear();
});
