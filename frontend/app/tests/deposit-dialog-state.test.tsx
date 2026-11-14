import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { LegacyDepositForm } from "@/components/near/transfers";
import type { TrackedDepositQuote } from "@/lib/near/http/schemas/transfers";
const status = vi.hoisted(() => ({ value: "PENDING_DEPOSIT" as string | undefined, error: null as Error | null }));
vi.mock("@dya/wallet-ui/components/near/use-deposit-status", () => ({ useDepositStatus: () => ({ data: status.value ? { status: status.value, terminal: ["SUCCESS", "FAILED", "REFUNDED"].includes(status.value) } : undefined, error: status.error, refetch: vi.fn() }) }));
vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: async () => ({ assets: [{ ...DEFAULT_PAIR.quote, assetId: "base-usdc", blockchain: "base", coingeckoId: "usd-coin" }, DEFAULT_PAIR.quote] }) }));
vi.mock("@dya/ui/components/dialog-drawer", () => ({ DialogDrawerHeader: "header", DialogDrawerTitle: "h2", DialogDrawerDescription: "p" }));
vi.mock("@dya/wallet-ui/lib/deposit-qr", () => ({ depositQrDataUrl: async () => "data:image/png;base64,dGVzdA==" }));
const quote = { id: "test", asset: "USDT", sourceChain: "BSC", depositAddress: "0x123", amountInFormatted: "1", deadline: new Date(Date.now() + 600000).toISOString() } as TrackedDepositQuote;
beforeEach(() => { status.value = "PENDING_DEPOSIT"; status.error = null; });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = () => <QueryClientProvider client={client}><LegacyDepositForm accountId="test" initialQuote={quote} /></QueryClientProvider>;
  return { ...render(element()), element };
}
it("replaces payment instructions with processing and then completion", async () => {
  const view = setup();
  await screen.findByAltText(/QR code/);
  expect(screen.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
  for (const value of ["KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"]) {
    status.value = value; view.rerender(view.element());
    expect(screen.getByRole("heading", { name: value === "SUCCESS" ? "Deposit complete" : "Deposit received" })).toBeInTheDocument();
    expect(screen.queryByAltText(/QR code/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
    expect(screen.queryByText(/Send exactly/)).toBeNull();
  }
});
it.each([["FAILED", "Deposit couldn’t be completed"], ["REFUNDED", "Deposit refunded"], ["INCOMPLETE_DEPOSIT", "Deposit needs attention"]])("shows %s without reusable payment instructions", (value, title) => {
  status.value = value; setup();
  expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
});
it("checks reopened deposits before showing the QR and offers retry on failure", () => {
  status.value = undefined; status.error = new Error("offline"); setup();
  expect(screen.getByRole("heading", { name: "Unable to check deposit" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});

it("provides Done and View details actions for terminal states", () => {
  const close = vi.fn(), details = vi.fn();
  const client = new QueryClient();
  const element = () => <QueryClientProvider client={client}><LegacyDepositForm accountId="test" initialQuote={quote} onClose={close} onDetails={details} /></QueryClientProvider>;
  status.value = "SUCCESS";
  const view = render(element());
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(close).toHaveBeenCalledTimes(1);
  status.value = "FAILED";
  view.rerender(element());
  fireEvent.click(screen.getByRole("button", { name: "View details" }));
  expect(details).toHaveBeenCalledTimes(1);
});
it("replaces expired instructions and shows unavailability for an empty catalog, while detected deposits take precedence", async () => {
  vi.useFakeTimers();
  try {
    const { act } = await import("@testing-library/react");
    const details = vi.fn();
    const expiredQuote = { ...quote, deadline: new Date(Date.now() - 10000).toISOString() };
    const client = new QueryClient();
    const element = () => <QueryClientProvider client={client}><LegacyDepositForm accountId="test" initialQuote={expiredQuote} onDetails={details} /></QueryClientProvider>;
    const view = render(element());
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("heading", { name: "Deposit address expired" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Already sent funds? View status" }));
    expect(details).toHaveBeenCalledOnce();
    status.value = "PROCESSING";
    view.rerender(element());
    expect(screen.getByRole("heading", { name: "Deposit received" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create new address" })).toBeNull();
    status.value = "PENDING_DEPOSIT";
    view.rerender(element());
    fireEvent.click(screen.getByRole("button", { name: "Create new address" }));
    expect(screen.getByText("Deposits temporarily unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deposit network" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
  } finally { vi.useRealTimers(); }
});

it.each([["base-usdc", true], [DEFAULT_PAIR.quote.assetId, false]] as const)("offers Move to Trading only for a completed funding deposit: %s", async (targetAssetId, expected) => {
  status.value = "SUCCESS";
  const onMove = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><LegacyDepositForm accountId="test" initialQuote={{ ...quote, targetAssetId }} onMoveToTrading={onMove} /></QueryClientProvider>);
  if (expected) {
    fireEvent.click(await screen.findByRole("button", { name: "Move to Trading" }));
    expect(onMove).toHaveBeenCalledOnce();
    expect(screen.getByText(/Funds received in Funding/)).toBeInTheDocument();
  } else {
    await screen.findByText("Your deposit is complete. Your balance is refreshing.");
    expect(screen.queryByRole("button", { name: "Move to Trading" })).toBeNull();
  }
});
