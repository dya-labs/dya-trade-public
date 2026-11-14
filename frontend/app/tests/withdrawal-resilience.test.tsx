import { toast } from "@dya/ui/lib/toast";
vi.mock("@dya/ui/lib/toast", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
import { withTokenPolicy } from "./fixtures/token-policy";
import { approvedTestNetworks } from "./fixtures/network-policy";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WithdrawalForm } from "@/components/near/withdrawal-form";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { StandaloneWalletContext } from "@dya/wallet-ui/components/presentation";
import { prepareWithdrawal, submitWithdrawal } from "@dya/wallet-ui/lib/near/http/transfers-client";

const state = vi.hoisted(() => ({ mode: "known" as "known" | "missing" | "stale", refetch: vi.fn() }));
vi.mock("@dya/wallet-ui/lib/near/http/transfers-client", () => ({ prepareWithdrawal: vi.fn(), submitWithdrawal: vi.fn(), getWithdrawalStatus: vi.fn() }));
vi.mock("@dya/wallet-ui/components/near/asset-mark", () => ({ AssetMark: () => null }));
vi.mock("@dya/wallet-ui/components/near/network-mark", () => ({ NetworkMark: () => null }));
vi.mock("@dya/wallet-ui/components/near/use-live-balances", () => ({ useBalanceQuery: () => ({
  data: state.mode === "missing" ? undefined : { assets: [{ ...DEFAULT_PAIR.quote, amount: "2.803025", raw: "2803025" }] },
  error: state.mode === "known" ? null : new Error("private provider offline"), isPending: false, isFetching: false, refetch: state.refetch,
}) }));
vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: async () => {
  const origin = { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" };
  return withTokenPolicy({ networks: approvedTestNetworks, assets: [origin, { ...origin, assetId: "base-usdc", blockchain: "base" }] });
} }));

const clients: QueryClient[] = [];
beforeEach(() => { state.mode = "known"; vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });
async function recipientScreen(authenticate = vi.fn(), accountId = "resilience-account", onBusyChange?: (busy: boolean) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const component = () => <QueryClientProvider client={client}><StandaloneWalletContext.Provider value={true}><WithdrawalForm accountId={accountId} authenticate={authenticate} onBusyChange={onBusyChange} /></StandaloneWalletContext.Provider></QueryClientProvider>;
  const view = render(component());
  await waitFor(() => expect(screen.getByRole("button", { name: "Withdrawal token" })).toHaveTextContent("USDC"));
  fireEvent.click(screen.getByRole("button", { name: "Withdrawal network" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search networks" }), { target: { value: "Base" } });
  fireEvent.click(screen.getByRole("button", { name: "Base" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  return { view, rerender: () => view.rerender(component()) };
}
async function amountScreen(authenticate = vi.fn(), onBusyChange?: (busy: boolean) => void) {
  const view = await recipientScreen(authenticate, "resilience-account", onBusyChange);
  fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: "0x1234567890123456789012345678901234567890" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  return view;
}

it("shows unknown balance as unavailable and puts retry before the blocked withdrawal action", async () => {
  const { rerender } = await amountScreen();
  fireEvent.change(screen.getByLabelText("Amount (USDC)"), { target: { value: "1.25" } });
  state.mode = "missing"; rerender();
  expect(screen.getByText("Available: -")).toBeVisible();
  expect(screen.getByLabelText("Amount (USDC)")).toHaveValue("1.25");
  const action = screen.getByRole("button", { name: "Review withdrawal" });
  expect(action).toBeDisabled(); expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
  const retry = screen.getByRole("button", { name: "Retry" });
  expect(retry.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  fireEvent.click(retry); expect(state.refetch).toHaveBeenCalledOnce();
  state.mode = "known"; rerender();
  expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "Available: 2.80 USDC")).toBeVisible();
  expect(screen.getByLabelText("Amount (USDC)")).toHaveValue("1.25");
  expect(screen.getByRole("button", { name: "Review withdrawal" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(prepareWithdrawal).not.toHaveBeenCalled();
});

it("preserves last-known balances and input while disabling spending during a failed refresh", async () => {
  const { rerender } = await amountScreen();
  fireEvent.change(screen.getByLabelText("Amount (USDC)"), { target: { value: "1.25" } });
  state.mode = "stale"; rerender();
  expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "Available: 2.80 USDC")).toBeVisible();
  expect(screen.getByLabelText("Amount (USDC)")).toHaveValue("1.25");
  expect(screen.getByRole("button", { name: "Review withdrawal" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "25%" })).toBeDisabled();
  expect(prepareWithdrawal).not.toHaveBeenCalled();
});

it("treats a cancelled passkey as retryable without submitting or exposing browser internals", async () => {
  const authenticate = vi.fn().mockRejectedValue(new DOMException("WebAuthn opaque browser diagnostic", "NotAllowedError"));
  vi.mocked(prepareWithdrawal).mockResolvedValue({ options: {}, review: { amount: "1", expectedReceive: "0.99", minimumReceive: "0.98", asset: "USDC", destinationChain: "Base", destinationWallet: "0x1234567890123456789012345678901234567890", deadline: new Date(Date.now() + 60000).toISOString() } } as Awaited<ReturnType<typeof prepareWithdrawal>>);
  await amountScreen(authenticate);
  fireEvent.change(screen.getByLabelText("Amount (USDC)"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review withdrawal" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm withdrawal" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Confirmation cancelled"));
  expect(screen.queryByText(/opaque browser diagnostic/)).toBeNull();
  expect(screen.getByLabelText("Amount (USDC)")).toHaveValue("1");
  expect(screen.getByRole("button", { name: "Review withdrawal" })).toBeEnabled();
  expect(submitWithdrawal).not.toHaveBeenCalled();
  expect(screen.queryByText("Submission unconfirmed")).toBeNull();
});

it("refreshes an expired quote before allowing passkey confirmation", async () => {
  const authenticate = vi.fn();
  const quote = (deadline: number) => ({ options: {}, review: { amount: "1", expectedReceive: "0.99", minimumReceive: "0.98", asset: "USDC", destinationChain: "Base", destinationWallet: "0x1234567890123456789012345678901234567890", deadline: new Date(deadline).toISOString() } } as Awaited<ReturnType<typeof prepareWithdrawal>>);
  vi.mocked(prepareWithdrawal).mockResolvedValueOnce(quote(Date.now() - 1000)).mockResolvedValueOnce(quote(Date.now() + 60000));
  await amountScreen(authenticate);
  fireEvent.change(screen.getByLabelText("Amount (USDC)"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review withdrawal" }));
  fireEvent.click(await screen.findByRole("button", { name: "Refresh quote" }));
  expect(await screen.findByRole("button", { name: "Confirm withdrawal" })).toBeEnabled();
  expect(prepareWithdrawal).toHaveBeenCalledTimes(2);
  expect(prepareWithdrawal).toHaveBeenLastCalledWith({ originAssetId: DEFAULT_PAIR.quote.assetId, destinationAssetId: "base-usdc", wallet: "0x1234567890123456789012345678901234567890", amount: "1" });
  expect(authenticate).not.toHaveBeenCalled(); expect(submitWithdrawal).not.toHaveBeenCalled();
});

it("keeps recent recipients scoped to the account and network", async () => {
  localStorage.setItem("withdrawal-recipients:other-account:base", JSON.stringify(["other-wallet"]));
  localStorage.setItem("withdrawal-recipients:resilience-account:eth", JSON.stringify(["ethereum-wallet"]));
  localStorage.setItem("withdrawal-recipients:resilience-account:base", JSON.stringify(["0x1111111111111111111111111111111111111111"]));
  await recipientScreen();
  const recent = await screen.findByRole("button", { name: "Recent recipient 0x1111111111111111111111111111111111111111" });
  expect(screen.queryByRole("button", { name: /other-wallet|ethereum-wallet/ })).toBeNull();
  fireEvent.click(recent);
  expect(screen.getByRole("button", { name: "Copy recipient address" })).toBeVisible();
  expect(localStorage.getItem("withdrawal-recipients:resilience-account:base")).toBe(JSON.stringify(["0x1111111111111111111111111111111111111111"]));
  expect(prepareWithdrawal).not.toHaveBeenCalled();
});

it("recovers from corrupt recent-recipient storage without blocking manual entry", async () => {
  localStorage.setItem("withdrawal-recipients:resilience-account:base", "{broken");
  await recipientScreen();
  expect(screen.queryByText("Recent")).toBeNull();
  fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: "  0x1234567890123456789012345678901234567890  " } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(localStorage.getItem("withdrawal-recipients:resilience-account:base")).toBe(JSON.stringify(["0x1234567890123456789012345678901234567890"]));
  expect(screen.getByLabelText("Amount (USDC)")).toBeVisible();
});

it("caps recent recipients at five and moves a selected address first without duplicates", async () => {
  const addresses = Array.from({ length: 6 }, (_, i) => `0x${String(i + 1).repeat(40)}`);
  const key = "withdrawal-recipients:resilience-account:base";
  localStorage.setItem(key, JSON.stringify(addresses));
  await recipientScreen();
  expect(await screen.findAllByRole("button", { name: /^Recent recipient/ })).toHaveLength(5);
  expect(screen.queryByRole("button", { name: `Recent recipient ${addresses[5]}` })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: `Recent recipient ${addresses[3]}` }));
  const expected = [addresses[3], addresses[0], addresses[1], addresses[2], addresses[4]];
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(expected);
  fireEvent.click(screen.getByRole("button", { name: "Back to recipient" }));
  fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: "" } });
  expect(screen.getAllByRole("button", { name: /^Recent recipient/ }).map(button => button.getAttribute("aria-label"))).toEqual(expected.map(address => `Recent recipient ${address}`));
  expect(prepareWithdrawal).not.toHaveBeenCalled();
});

it("evicts the oldest recipient when a new trimmed address is selected", async () => {
  const addresses = Array.from({ length: 5 }, (_, i) => `0x${String(i + 1).repeat(40)}`);
  const key = "withdrawal-recipients:resilience-account:base";
  localStorage.setItem(key, JSON.stringify(addresses));
  await recipientScreen();
  await screen.findAllByRole("button", { name: /^Recent recipient/ });
  const address = `0x${"9".repeat(40)}`;
  fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: `  ${address}  ` } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual([address, ...addresses.slice(0, 4)]);
  expect(screen.getByRole("button", { name: "Copy recipient address" })).toBeVisible();
  expect(prepareWithdrawal).not.toHaveBeenCalled();
});

it("filters recent addresses while preserving manual entry when none match", async () => {
  const first = `0x${"1".repeat(40)}`, second = `0x${"2".repeat(40)}`;
  localStorage.setItem("withdrawal-recipients:resilience-account:base", JSON.stringify([first, second]));
  await recipientScreen();
  await screen.findAllByRole("button", { name: /^Recent recipient/ });
  fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: "  1111  " } });
  expect(screen.getAllByRole("button", { name: /^Recent recipient/ })).toHaveLength(1);
  expect(screen.getByRole("button", { name: `Recent recipient ${first}` })).toBeVisible();
  const manual = `0x${"9".repeat(40)}`;
  fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: manual } });
  expect(screen.queryByText("Recent")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: `Select recipient ${manual}` }));
  expect(screen.getByLabelText("Amount (USDC)")).toBeVisible();
  expect(prepareWithdrawal).not.toHaveBeenCalled();
});

it("continues recipient selection when browser storage reads and writes are denied", async () => {
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
  try {
    await recipientScreen();
    const address = `0x${"9".repeat(40)}`;
    fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByLabelText("Amount (USDC)")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to recipient" }));
    fireEvent.change(screen.getByLabelText("Address on Base"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: `Recent recipient ${address}` })).toBeVisible();
    expect(prepareWithdrawal).not.toHaveBeenCalled();
  } finally { read.mockRestore(); write.mockRestore(); }
});

it("reports clipboard failure and lets the user retry copying the same recipient", async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error("Clipboard denied")).mockResolvedValueOnce(undefined);
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    await amountScreen();
    fireEvent.click(screen.getByRole("button", { name: "Copy recipient address" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unable to copy address. Please copy it manually."));
    fireEvent.click(screen.getByRole("button", { name: "Copy recipient address" }));
    expect(await screen.findByRole("button", { name: "Address copied" })).toBeVisible();
    expect(screen.queryByText("Unable to copy address. Please copy it manually.")).toBeNull();
    expect(writeText).toHaveBeenLastCalledWith("0x1234567890123456789012345678901234567890");
    expect(screen.getByLabelText("Amount (USDC)")).toBeVisible();
  } finally {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

function preparedWithdrawal(deadline: number) {
  return { options: {}, review: { amount: "1", expectedReceive: "0.99", minimumReceive: "0.98", asset: "USDC", destinationChain: "Base", destinationWallet: "0x1234567890123456789012345678901234567890", deadline: new Date(deadline).toISOString() } } as Awaited<ReturnType<typeof prepareWithdrawal>>;
}
function syntheticAssertion() {
  return { id: "synthetic", rawId: "synthetic", type: "public-key" as const, response: { clientDataJSON: "synthetic", authenticatorData: "synthetic", signature: "synthetic" }, clientExtensionResults: {} };
}
it("does not submit a withdrawal or retain its parent busy lock after late confirmation on an unmounted form", async () => {
  let finish!: (value: ReturnType<typeof syntheticAssertion>) => void;
  const authenticate = vi.fn(() => new Promise<ReturnType<typeof syntheticAssertion>>(resolve => { finish = resolve; }));
  const busy = vi.fn();
  vi.mocked(prepareWithdrawal).mockResolvedValue(preparedWithdrawal(Date.now() + 60000));
  const { view } = await amountScreen(authenticate, busy);
  fireEvent.change(screen.getByLabelText("Amount (USDC)"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review withdrawal" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm withdrawal" }));
  expect(authenticate).toHaveBeenCalledOnce();expect(busy).toHaveBeenLastCalledWith(true);
  view.unmount();
  await act(async () => { finish(syntheticAssertion()); });
  expect.soft(submitWithdrawal).not.toHaveBeenCalled();
  expect(busy).toHaveBeenLastCalledWith(false);
});
it("blocks a withdrawal quote expiring during device confirmation and permits refresh without uncertain submission", async () => {
  const deadline = Date.now() + 60000;
  let finish!: (value: ReturnType<typeof syntheticAssertion>) => void;
  const authenticate = vi.fn(() => new Promise<ReturnType<typeof syntheticAssertion>>(resolve => { finish = resolve; }));
  vi.mocked(prepareWithdrawal).mockResolvedValueOnce(preparedWithdrawal(deadline)).mockResolvedValueOnce(preparedWithdrawal(deadline + 60000));
  await amountScreen(authenticate);
  fireEvent.change(screen.getByLabelText("Amount (USDC)"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review withdrawal" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm withdrawal" }));
  expect(authenticate).toHaveBeenCalledOnce();
  vi.spyOn(Date, "now").mockReturnValue(deadline);
  await act(async () => { finish(syntheticAssertion()); });
  expect(submitWithdrawal).not.toHaveBeenCalled();
  expect(screen.queryByText("Submission unconfirmed")).toBeNull();
  expect(await screen.findByText("Withdrawal quote has expired. Refresh the quote before confirming.")).toBeVisible();
  const refresh = await screen.findByRole("button", { name: "Refresh quote" });
  expect(refresh).toBeEnabled();fireEvent.click(refresh);
  expect(await screen.findByRole("button", { name: "Confirm withdrawal" })).toBeEnabled();
  expect(prepareWithdrawal).toHaveBeenCalledTimes(2);
  expect(prepareWithdrawal).toHaveBeenLastCalledWith(expect.objectContaining({ amount: "1" }));
  expect(authenticate).toHaveBeenCalledOnce();
});

it("checks the withdrawal deadline before device confirmation even when the visible countdown has not ticked", async () => {
  const deadline = Date.now() + 60000;
  const authenticate = vi.fn();
  vi.mocked(prepareWithdrawal).mockResolvedValue(preparedWithdrawal(deadline));
  await amountScreen(authenticate);
  fireEvent.change(screen.getByLabelText("Amount (USDC)"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review withdrawal" }));
  const confirm = await screen.findByRole("button", { name: "Confirm withdrawal" });
  vi.spyOn(Date, "now").mockReturnValue(deadline);
  fireEvent.click(confirm);
  expect(authenticate).not.toHaveBeenCalled();expect(submitWithdrawal).not.toHaveBeenCalled();
  expect(await screen.findByRole("button", { name: "Refresh quote" })).toBeEnabled();
  expect(screen.queryByText("Submission unconfirmed")).toBeNull();
});
