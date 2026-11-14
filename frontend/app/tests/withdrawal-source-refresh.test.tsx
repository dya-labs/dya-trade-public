import { withTokenPolicy } from "./fixtures/token-policy";
import { approvedTestNetworks } from "./fixtures/network-policy";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WithdrawalForm } from "@/components/near/withdrawal-form";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { prepareWithdrawal } from "@dya/wallet-ui/lib/near/http/transfers-client";
import { StandaloneWalletContext } from "@dya/wallet-ui/components/presentation";

const state = vi.hoisted(() => ({ mode: "funded" as "funded" | "zero" | "missing", defaultSource: false }));
vi.mock("@dya/wallet-ui/lib/near/http/transfers-client", () => ({ prepareWithdrawal: vi.fn(), submitWithdrawal: vi.fn(), getWithdrawalStatus: vi.fn() }));
vi.mock("@dya/wallet-ui/components/near/asset-mark", () => ({ AssetMark: () => null }));
vi.mock("@dya/wallet-ui/components/near/network-mark", () => ({ NetworkMark: () => null }));
vi.mock("@dya/wallet-ui/components/near/use-live-balances", () => ({ useBalanceQuery: () => ({ data: { assets: [
  ...(state.defaultSource && state.mode === "missing" ? [] : [{ ...DEFAULT_PAIR.quote, raw: state.defaultSource && state.mode === "zero" ? "0" : "2803025", amount: state.defaultSource && state.mode === "zero" ? "0" : "2.803025" }]),
  ...(!state.defaultSource && state.mode === "missing" ? [] : [{ ...DEFAULT_PAIR.quote, assetId: "source-base-usdc", raw: !state.defaultSource && state.mode === "zero" ? "0" : "4000000", amount: !state.defaultSource && state.mode === "zero" ? "0" : "4" }]),
] }, error: null }) }));
vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: async () => (withTokenPolicy({ networks: approvedTestNetworks, assets: [
  { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" },
  { ...DEFAULT_PAIR.quote, assetId: "source-base-usdc", blockchain: "base", coingeckoId: "usd-coin" },
] })) }));
const clients: QueryClient[] = [];
beforeEach(() => { vi.stubGlobal("PointerEvent", MouseEvent); });
afterEach(() => { clients.splice(0).forEach(client => client.clear());state.mode = "funded";state.defaultSource = false;vi.clearAllMocks();vi.unstubAllGlobals();localStorage.clear(); });

it.each(["zero", "missing"] as const)("keeps another funded withdrawal source reachable when selected balance becomes %s", async mode => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });clients.push(client);
  const component = () => <QueryClientProvider client={client}><StandaloneWalletContext.Provider value={true}><WithdrawalForm accountId="source-refresh" /></StandaloneWalletContext.Provider></QueryClientProvider>;
  const view = render(component());
  await waitFor(() => expect(screen.getByRole("button", { name: "Withdrawal token" })).toHaveTextContent("USDC"));
  fireEvent.click(screen.getByRole("button", { name: "Withdrawal network" }));
  fireEvent.click(screen.getByRole("button", { name: "Base" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: "0x1234567890123456789012345678901234567890" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("combobox", { name: "Source balance" }));
  const base = await screen.findByRole("option", { name: "Base balance" });fireEvent.pointerDown(base);fireEvent.click(base);
  await waitFor(() => expect(screen.queryByRole("option", { name: "Base balance" })).toBeNull());
  fireEvent.change(screen.getByLabelText("Amount (USDC)"), { target: { value: "1" } });
  expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "Available: 4.00 USDC")).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Source balance" })).toHaveTextContent("Base balance");
  state.mode = mode;view.rerender(component());
  expect(screen.getByLabelText("Amount (USDC)")).toHaveValue("1");
  expect(screen.getByRole("button", { name: mode === "zero" ? "Insufficient balance" : "Review withdrawal" })).toBeDisabled();
  fireEvent.click(screen.getByRole("combobox", { name: "Source balance" }));
  const near = await screen.findByRole("option", { name: "NEAR balance" });fireEvent.pointerDown(near, {button: 0});fireEvent.click(near, {detail: 1});
  await waitFor(() => expect(screen.getByLabelText("Amount (USDC)")).toHaveValue(""));
  expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "Available: 2.80 USDC")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Max" }));
  expect(screen.getByLabelText("Amount (USDC)")).toHaveValue("2.803025");
  expect(screen.getByRole("button", { name: "Review withdrawal" })).toBeEnabled();
  expect(prepareWithdrawal).not.toHaveBeenCalled();
});

it.each(["zero", "missing"] as const)("keeps the default withdrawal source bound when its balance becomes %s", async mode => {
  state.defaultSource = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });clients.push(client);
  const component = () => <QueryClientProvider client={client}><StandaloneWalletContext.Provider value={true}><WithdrawalForm accountId="source-refresh" /></StandaloneWalletContext.Provider></QueryClientProvider>;
  const view = render(component());
  await waitFor(() => expect(screen.getByRole("button", { name: "Withdrawal token" })).toHaveTextContent("USDC"));
  fireEvent.click(screen.getByRole("button", { name: "Withdrawal network" }));
  fireEvent.click(screen.getByRole("button", { name: "Base" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: "0x1234567890123456789012345678901234567890" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByLabelText("Amount (USDC)"), { target: { value: "1" } });
  expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "Available: 2.80 USDC")).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Source balance" })).toHaveTextContent("NEAR balance");
  state.mode = mode;view.rerender(component());
  expect(screen.getByLabelText("Amount (USDC)")).toHaveValue("1");
  expect(screen.getByRole("button", { name: mode === "zero" ? "Insufficient balance" : "Review withdrawal" })).toBeDisabled();
  fireEvent.click(screen.getByRole("combobox", { name: "Source balance" }));
  const base = await screen.findByRole("option", { name: "Base balance" });fireEvent.pointerDown(base, {button: 0});fireEvent.click(base, {detail: 1});
  await waitFor(() => expect(screen.getByLabelText("Amount (USDC)")).toHaveValue(""));
  expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "Available: 4.00 USDC")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Max" }));
  expect(screen.getByLabelText("Amount (USDC)")).toHaveValue("4");
  expect(screen.getByRole("button", { name: "Review withdrawal" })).toBeEnabled();
  expect(prepareWithdrawal).not.toHaveBeenCalled();
});

it.each(["amount", "review"] as const)("blocks a removed destination network from the withdrawal %s step and offers network selection", async phase => {
  const authenticate = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });clients.push(client);
  const component = () => <QueryClientProvider client={client}><StandaloneWalletContext.Provider value={true}><WithdrawalForm accountId="source-refresh" authenticate={authenticate} /></StandaloneWalletContext.Provider></QueryClientProvider>;
  render(component());
  await waitFor(() => expect(screen.getByRole("button", { name: "Withdrawal token" })).toHaveTextContent("USDC"));
  fireEvent.click(screen.getByRole("button", { name: "Withdrawal network" }));
  fireEvent.click(screen.getByRole("button", { name: "Base" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: "0x1234567890123456789012345678901234567890" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByLabelText("Amount (USDC)"), { target: { value: "1" } });
  vi.mocked(prepareWithdrawal).mockResolvedValue({ options: {}, review: { amount: "1", expectedReceive: "0.99", minimumReceive: "0.98", asset: "USDC", destinationChain: "Base", destinationWallet: "0x1234567890123456789012345678901234567890", deadline: new Date(Date.now() + 60000).toISOString() } } as Awaited<ReturnType<typeof prepareWithdrawal>>);
  if (phase === "review") {
    fireEvent.click(screen.getByRole("button", { name: "Review withdrawal" }));
    await screen.findByRole("button", { name: "Confirm withdrawal" });
  }
  await act(async () => { client.setQueryData(["near", "catalog"], withTokenPolicy({ networks: approvedTestNetworks, assets: [{ ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" }] })); });
  const action = screen.getByRole("button", { name: phase === "review" ? "Confirm withdrawal" : "Review withdrawal" });
  await waitFor(() => expect(action).toBeDisabled());
  expect(await screen.findByText("Destination network is unavailable. Choose another network to continue.")).toBeVisible();
  fireEvent.click(action);expect(authenticate).not.toHaveBeenCalled();
  expect(prepareWithdrawal).toHaveBeenCalledTimes(phase === "review" ? 1 : 0);
  fireEvent.click(screen.getByRole("button", { name: "Choose network" }));
  expect(await screen.findByRole("heading", { name: "Withdraw" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Withdrawal network" }));
  fireEvent.click(screen.getByRole("button", { name: "NEAR" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByLabelText("Address on NEAR")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
});

it.each(["amount", "review"] as const)("blocks a removed source network from the withdrawal %s step until an explicit replacement", async phase => {
  const authenticate = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });clients.push(client);
  const component = () => <QueryClientProvider client={client}><StandaloneWalletContext.Provider value={true}><WithdrawalForm accountId="source-refresh" authenticate={authenticate} /></StandaloneWalletContext.Provider></QueryClientProvider>;
  render(component());
  await waitFor(() => expect(screen.getByRole("button", { name: "Withdrawal token" })).toHaveTextContent("USDC"));
  fireEvent.click(screen.getByRole("button", { name: "Withdrawal network" }));
  fireEvent.click(screen.getByRole("button", { name: "NEAR" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByLabelText("Address on NEAR"), { target: { value: "0x1234567890123456789012345678901234567890" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("combobox", { name: "Source balance" }));
  const base = await screen.findByRole("option", { name: "Base balance" });fireEvent.pointerDown(base);fireEvent.click(base);
  await waitFor(() => expect(screen.queryByRole("option", { name: "Base balance" })).toBeNull());
  fireEvent.change(screen.getByLabelText("Amount (USDC)"), { target: { value: "1" } });
  vi.mocked(prepareWithdrawal).mockResolvedValue({ options: {}, review: { amount: "1", expectedReceive: "0.99", minimumReceive: "0.98", asset: "USDC", destinationChain: "NEAR", destinationWallet: "0x1234567890123456789012345678901234567890", deadline: new Date(Date.now() + 60000).toISOString() } } as Awaited<ReturnType<typeof prepareWithdrawal>>);
  if (phase === "review") {
    fireEvent.click(screen.getByRole("button", { name: "Review withdrawal" }));
    await screen.findByRole("button", { name: "Confirm withdrawal" });
  }
  await act(async () => { client.setQueryData(["near", "catalog"], withTokenPolicy({ networks: approvedTestNetworks, assets: [{ ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" }] })); });
  const action = screen.getByRole("button", { name: phase === "review" ? "Confirm withdrawal" : "Review withdrawal" });
  await waitFor(() => expect(action).toBeDisabled());
  expect(await screen.findByText("Source network is unavailable. Choose another source balance to continue.")).toBeVisible();
  fireEvent.click(action);expect(authenticate).not.toHaveBeenCalled();
  expect(prepareWithdrawal).toHaveBeenCalledTimes(phase === "review" ? 1 : 0);
  if (phase === "review") fireEvent.click(screen.getByRole("button", { name: "Choose source" }));
  const sourcePicker = await screen.findByRole("combobox", { name: "Source balance" });
  expect(sourcePicker).toHaveTextContent("Select source");
  fireEvent.click(sourcePicker);
  const near = await screen.findByRole("option", { name: "NEAR balance" });fireEvent.pointerDown(near);fireEvent.click(near);
  await waitFor(() => expect(screen.getByLabelText("Amount (USDC)")).toHaveValue(""));
  expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "Available: 2.80 USDC")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Max" }));
  expect(screen.getByLabelText("Amount (USDC)")).toHaveValue("2.803025");
  expect(screen.getByRole("button", { name: "Review withdrawal" })).toBeEnabled();
  expect(screen.queryByText("Source network is unavailable. Choose another source balance to continue.")).toBeNull();
});
