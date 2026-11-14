import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@dya/wallet-sdk";
import { toast } from "@dya/ui/lib/toast";
import { prepareConfidentialAccess } from "@/lib/near/http/confidential-client";
import { limitReview } from "./fixtures/limit-review";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import type { MarketReview, MarketPreview } from "@/lib/near/http/schemas/trading";
import { useOrderTicket } from "@/components/near/use-order-ticket";
import { OrderTicketForm } from "@/components/near/ticket";
import { prepareLimitOrder, prepareMarketOrder, previewMarketOrder, submitMarketOrder, submitLimitOrder } from "@/lib/near/http/trading-client";

vi.mock("@dya/ui/lib/toast", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), loading: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("@/lib/near/http/confidential-client", () => ({ prepareConfidentialAccess: vi.fn(), unlockConfidentialAccess: vi.fn() }));
vi.mock("@dya/wallet-sdk", () => ({ startAuthentication: vi.fn(), connect: vi.fn() }));
vi.mock("@dya/wallet-ui/components/near/use-live-balances", () => ({ useLiveBalances: () => ({ balances: { assets: [{ ...DEFAULT_PAIR.quote, amount: "100" }] }, balanceError: "", accessRequired: false, loading: false, refresh: vi.fn() }) }));
vi.mock("@/components/near/use-market-quote", () => ({ MARKET_QUOTE_DEBOUNCE_MS: 300, useMarketQuote: () => ({ currentQuote: preliminary(), currentQuoteError: "", retryQuote: vi.fn() }) }));
vi.mock("@/lib/near/http/trading-client", () => ({ previewMarketOrder: vi.fn(), previewLimitOrder: vi.fn(), prepareMarketOrder: vi.fn(), prepareLimitOrder: vi.fn(), abandonLimitOrder: vi.fn(), submitMarketOrder: vi.fn(), submitLimitOrder: vi.fn(), getMarketTradeStatus: vi.fn() }));
const account = { id: "trade-review-test", kind: "passkey" as const };
const options = { challenge: "test-challenge" } satisfies PublicKeyCredentialRequestOptionsJSON;
function executable(expiresAt = new Date(Date.now() + 60_000).toISOString()): MarketReview {
  return { pair: DEFAULT_PAIR, confidentiality: "advanced", orderType: "market", side: "buy", quantity: "1", inputSymbol: "USDC", outputSymbol: "NEAR", principal: "4", estimatedOutput: "1", minimumOutput: "0.99", available: "100", shortfall: "0", balanceBlock: 1, slippageBps: 100, expiresAt, submissionEnabled: true, inputRaw: "4000000", outputRaw: "1000000000000000000000000", depositAddress: "test-only", depositMemo: null, correlationId: "test-only" };
}
function preliminary(): MarketPreview { return { ...executable(), submissionEnabled: false, timeEstimateSeconds: 30, quoteReference: "q".repeat(43) }; }
const clients: QueryClient[] = [];
function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={clients.at(-1)!}>{children}</QueryClientProvider>; }
function setupHook() { return renderHook(() => useOrderTicket(account, 4), { wrapper }); }
beforeEach(() => { vi.clearAllMocks(); clients.push(new QueryClient({ defaultOptions: { queries: { retry: false } } })); });
afterEach(() => { clients.splice(0).forEach(c => c.clear()); vi.useRealTimers(); });

it("blocks an executable quote that expires at the exact cutoff before opening ID", async () => {
  vi.useFakeTimers();
  vi.mocked(prepareMarketOrder).mockResolvedValue({ review: executable(new Date(Date.now()).toISOString()), options });
  const { result } = setupHook();
  act(() => result.current.editSize("1"));
  await act(() => result.current.openReview());
  expect(startAuthentication).not.toHaveBeenCalled();
  expect(submitMarketOrder).not.toHaveBeenCalled();
  expect(result.current.error).toMatch(/expired/i);
});

it("blocks expired preparation and permits a fresh Review without a Terminal dialog", async () => {
  vi.mocked(prepareMarketOrder).mockResolvedValueOnce({ review: executable(new Date(Date.now() - 1).toISOString()), options }).mockResolvedValueOnce({ review: executable(), options });
  vi.mocked(startAuthentication).mockRejectedValueOnce(new DOMException("Cancelled", "NotAllowedError"));
  render(<QueryClientProvider client={clients.at(-1)!}><OrderTicketForm account={account} signIn={vi.fn()} marketPrice={4} /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText("Size"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  await screen.findByText("Quote expired. Review again for a new quote.");
  expect(startAuthentication).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  await waitFor(() => expect(startAuthentication).toHaveBeenCalledOnce());
  expect(prepareMarketOrder).toHaveBeenCalledTimes(2);
  expect(previewMarketOrder).not.toHaveBeenCalled();
});

it("keeps a cancelled confirmation retryable without submitting or exposing the browser diagnostic", async () => {
  vi.mocked(prepareMarketOrder).mockResolvedValue({ review: executable(), options });
  vi.mocked(startAuthentication).mockRejectedValue(new DOMException("The operation either timed out or was not allowed", "NotAllowedError"));
  const { result } = setupHook();
  act(() => result.current.editSize("1"));
  await act(() => result.current.openReview());
  expect(result.current.error).toBe("");
  expect(toast).toHaveBeenCalledWith("Confirmation cancelled");
  expect(submitMarketOrder).not.toHaveBeenCalled();
  await act(() => result.current.openReview());
  expect(startAuthentication).toHaveBeenCalledTimes(2);
});

it("does not submit when the quote expires while the device confirmation is open", async () => {
  vi.useFakeTimers();
  let finish!: (value: Awaited<ReturnType<typeof startAuthentication>>) => void;
  vi.mocked(prepareMarketOrder).mockResolvedValue({ review: executable(), options });
  vi.mocked(startAuthentication).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result } = setupHook();
  act(() => result.current.editSize("1"));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.openReview(); await vi.advanceTimersByTimeAsync(60_000); });
  await act(async () => { finish({ id: "test", rawId: "test", type: "public-key", response: { clientDataJSON: "test", authenticatorData: "test", signature: "test" }, clientExtensionResults: {} }); await pending; });
  expect(submitMarketOrder).not.toHaveBeenCalled();
  expect(result.current.error).toMatch(/expired/);
  // Nothing was submitted, so the ticket takes a fresh Review.
  await act(() => result.current.openReview());
  expect(prepareMarketOrder).toHaveBeenCalledTimes(2);
});

it("retries preparation from Review without opening a Terminal dialog", async () => {
  vi.mocked(prepareMarketOrder).mockReset().mockRejectedValueOnce(new Error("Quote temporarily unavailable")).mockResolvedValueOnce({ review: executable(), options });
  vi.mocked(startAuthentication).mockRejectedValueOnce(new DOMException("Cancelled", "NotAllowedError"));
  render(<QueryClientProvider client={clients.at(-1)!}><OrderTicketForm account={account} signIn={vi.fn()} marketPrice={4} /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText("Size"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  await screen.findByText("Quote temporarily unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  await waitFor(() => expect(startAuthentication).toHaveBeenCalledOnce());
  expect(prepareMarketOrder).toHaveBeenLastCalledWith(expect.objectContaining({ quantity: "1", side: "buy", quoteReference: "q".repeat(43) }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Quote temporarily unavailable")).toBeNull();
});

it("blocks empty, nonpositive and malformed sizes before requesting a review", () => {
  render(<QueryClientProvider client={clients.at(-1)!}><OrderTicketForm account={account} signIn={vi.fn()} marketPrice={4} /></QueryClientProvider>);
  const size = screen.getByLabelText("Size");
  for (const value of ["", "0", "-1", "abc", "0.0000000000000000000000001"]) {
    fireEvent.change(size, { target: { value } });
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
    if (value) expect(size).toHaveAttribute("aria-invalid", "true");
  }
  expect(previewMarketOrder).not.toHaveBeenCalled();
  fireEvent.change(size, { target: { value: "1" } });
  expect(size).not.toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Review" })).toBeEnabled();
});

it("requires a valid positive limit price before review and recovers after correction", () => {
  render(<QueryClientProvider client={clients.at(-1)!}><OrderTicketForm account={account} signIn={vi.fn()} marketPrice={4} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("tab", { name: "Limit" }));
  fireEvent.change(screen.getByLabelText("Size"), { target: { value: "1" } });
  const price = screen.getByLabelText("Price (USDC)");
  for (const value of ["", "0", "-1", "abc", "1."]) {
    fireEvent.change(price, { target: { value } });
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
    if (value) expect(price).toHaveAttribute("aria-invalid", "true");
  }
  fireEvent.change(price, { target: { value: "4" } });
  expect(price).not.toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Review" })).toBeEnabled();
});

it.each(["market", "limit"] as const)("does not submit a %s order when device confirmation resolves after the ticket unmounts", async kind => {
  let finish!: (value: Awaited<ReturnType<typeof startAuthentication>>) => void;
  vi.mocked(prepareMarketOrder).mockResolvedValue({ review: executable(), options });
  vi.mocked(prepareLimitOrder).mockResolvedValue({ review: limitReview(), options });
  vi.mocked(startAuthentication).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = setupHook();
  act(() => { if (kind === "limit") { view.result.current.setOrderType("limit"); view.result.current.editPrice("4"); } view.result.current.editSize("1"); });
  let pending!: Promise<void>;
  act(() => { pending = view.result.current.openReview(); });
  await waitFor(() => expect(startAuthentication).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => {
    finish({ id: "synthetic", rawId: "synthetic", type: "public-key", response: { clientDataJSON: "synthetic", authenticatorData: "synthetic", signature: "synthetic" }, clientExtensionResults: {} });
    await pending;
  });
  expect(submitMarketOrder).not.toHaveBeenCalled();
  expect(submitLimitOrder).not.toHaveBeenCalled();
});

it("opens ID directly from Review, prevents duplicate preparations, and clears the successful draft", async () => {
  let finish!: (value: Awaited<ReturnType<typeof prepareMarketOrder>>) => void;
  vi.mocked(prepareMarketOrder).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(startAuthentication).mockResolvedValue({ id: "receipt" } as never);
  vi.mocked(submitMarketOrder).mockResolvedValue({ trade: { id: "market-flow-test" } } as never);
  const { result } = setupHook();
  act(() => result.current.editSize("1"));
  let first!: Promise<void>;
  act(() => { first = result.current.openReview(); void result.current.openReview(); });
  expect(prepareMarketOrder).toHaveBeenCalledOnce();
  await act(async () => { finish({ review: executable(), options }); await first; });
  expect(previewMarketOrder).not.toHaveBeenCalled();
  expect(startAuthentication).toHaveBeenCalledExactlyOnceWith({ optionsJSON: options });
  expect(submitMarketOrder).toHaveBeenCalledExactlyOnceWith({ id: "receipt" });
  expect(result.current.quantity).toBe("");
  expect(result.current.attempt.phase).toBe("idle");
});

it("does not open ID for an executable quote with a balance shortfall", async () => {
  vi.mocked(prepareMarketOrder).mockResolvedValue({ review: { ...executable(), shortfall: "1" }, options });
  const { result } = setupHook();
  act(() => result.current.editSize("1"));
  await act(() => result.current.openReview());
  // The shortfall shows on the size field, not as a ticket-wide error.
  expect(result.current.sizeError).toBe("Insufficient funding balance.");
  expect(result.current.error).toBe("");
  expect(startAuthentication).not.toHaveBeenCalled();
});

it("keeps an uncertain one-click market receipt from being signed again", async () => {
  vi.mocked(prepareMarketOrder).mockResolvedValue({ review: executable(), options });
  vi.mocked(startAuthentication).mockResolvedValue({ id: "receipt" } as never);
  vi.mocked(submitMarketOrder).mockRejectedValue(new Error("Receipt unavailable"));
  const { result } = setupHook();
  act(() => result.current.editSize("1"));
  await act(() => result.current.openReview());
  await act(() => result.current.openReview());
  expect(result.current.attempt).toEqual({ phase: "uncertain", order: "market" });
  expect(result.current.error).toMatch(/My trades/);
  expect(prepareMarketOrder).toHaveBeenCalledOnce();
  expect(startAuthentication).toHaveBeenCalledOnce();
});

it("says a market order is being submitted, then sends a lost receipt to My trades", async () => {
  vi.mocked(prepareMarketOrder).mockResolvedValue({ review: executable(), options });
  vi.mocked(startAuthentication).mockResolvedValue({ id: "receipt" } as never);
  let fail!: (reason: Error) => void; vi.mocked(submitMarketOrder).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  render(<QueryClientProvider client={clients.at(-1)!}><OrderTicketForm account={account} signIn={vi.fn()} marketPrice={4} /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText("Size"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(await screen.findByRole("button", { name: "Submitting…" })).toBeDisabled();
  await act(async () => fail(new Error("Transport interrupted")));
  expect(await screen.findByText(/Submission could not be confirmed.*My trades/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Check My trades" })).toBeDisabled();
});

it("retrieves ID's submitted receipt even if the quote expires while the completion message returns", async () => {
  vi.useFakeTimers();
  let finish!: (value: Awaited<ReturnType<typeof startAuthentication>>) => void;
  vi.mocked(prepareMarketOrder).mockResolvedValue({ review: executable(), options });
  vi.mocked(startAuthentication).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(submitMarketOrder).mockResolvedValue({ trade: { id: "receipt-after-expiry" } } as never);
  const { result } = setupHook();
  act(() => result.current.editSize("1"));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.openReview(); await vi.advanceTimersByTimeAsync(60_000); });
  await act(async () => { finish({ id: "id-flow", dyaApproval: "id-flow" } as never); await pending; });
  expect(submitMarketOrder).toHaveBeenCalledExactlyOnceWith({ id: "id-flow", dyaApproval: "id-flow" });
  expect(result.current.error).toBe("");
});

it("preserves the market draft when ID returns an expired quote for review again", async () => {
 vi.mocked(prepareMarketOrder).mockResolvedValue({review:executable(),options});
 vi.mocked(startAuthentication).mockRejectedValue(Object.assign(new Error("Quote expired"),{name:"WalletQuoteExpiredError"}));
 const {result} = setupHook();
 act(() => result.current.editSize("1"));
 await act(() => result.current.openReview());
 expect(result.current.quantity).toBe("1");
 expect(result.current.attempt.phase).toBe("idle");
 expect(result.current.error).toBe("");
 expect(submitMarketOrder).not.toHaveBeenCalled();
});


it("shows a neutral toast when balance access confirmation is cancelled", async () => {
  vi.mocked(prepareConfidentialAccess).mockResolvedValue({ options });
  vi.mocked(startAuthentication).mockRejectedValueOnce(new DOMException("Cancelled", "NotAllowedError"));
  const { result } = setupHook();

  await act(() => result.current.confirmAccess());

  expect(toast).toHaveBeenCalledWith("Confirmation cancelled");
  expect(result.current.error).toBe("");
  expect(result.current.attempt.phase).toBe("idle");
});
