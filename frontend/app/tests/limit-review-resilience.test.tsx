import { toast } from "@dya/ui/lib/toast";
import { TOAST_MESSAGES } from "@dya/config";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startAuthentication } from "@dya/wallet-sdk";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { useOrderTicket } from "@/components/near/use-order-ticket";
import { OrderTicketForm } from "@/components/near/ticket";
import { abandonLimitOrder, prepareLimitOrder, previewLimitOrder, submitLimitOrder } from "@/lib/near/http/trading-client";
import { executableLimitReview } from "@/lib/near/http/schemas/trading";
import { limitReview } from "./fixtures/limit-review";
vi.mock("@dya/wallet-sdk", () => ({ startAuthentication: vi.fn(), connect: vi.fn() }));
vi.mock("@dya/wallet-ui/components/near/use-live-balances", () => ({ useLiveBalances: () => ({ balances: { assets: [{ ...DEFAULT_PAIR.quote, amount: "100" }] }, balanceError: "", accessRequired: false, loading: false, refresh: vi.fn() }) }));
vi.mock("@/components/near/use-market-quote", () => ({ MARKET_QUOTE_DEBOUNCE_MS: 300, useMarketQuote: () => ({ currentQuote: null, currentQuoteError: "", retryQuote: vi.fn() }) }));
vi.mock("@/lib/near/http/trading-client", () => ({ previewMarketOrder: vi.fn(), previewLimitOrder: vi.fn(), prepareMarketOrder: vi.fn(), prepareLimitOrder: vi.fn(), abandonLimitOrder: vi.fn(), submitMarketOrder: vi.fn(), submitLimitOrder: vi.fn(), getMarketTradeStatus: vi.fn() }));
vi.mock("@dya/ui/lib/toast", () => ({ toast: Object.assign(vi.fn(), { loading: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));
const account = { id: "limit-review-test", kind: "passkey" as const }, options = { challenge: "limit-test" };
const assertion = { id: "test", rawId: "test", type: "public-key" as const, response: { clientDataJSON: "test", authenticatorData: "test", signature: "test" }, clientExtensionResults: {} };
const clients: QueryClient[] = [];
function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={clients.at(-1)!}>{children}</QueryClientProvider>; }
function hook() { return renderHook(() => useOrderTicket(account, 4), { wrapper }); }
beforeEach(() => { vi.resetAllMocks(); clients.push(new QueryClient({ defaultOptions: { queries: { retry: false } } })); });
afterEach(() => { clients.splice(0).forEach(c => c.clear()); vi.useRealTimers(); });

it("does not fund when authorization expires while device confirmation is open", async () => {
  vi.useFakeTimers(); let finish!: (value: typeof assertion) => void;
  vi.mocked(prepareLimitOrder).mockResolvedValue({ review: limitReview(), options });
  vi.mocked(abandonLimitOrder).mockResolvedValue({ ok: true });
  vi.mocked(startAuthentication).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result } = hook();
  act(() => { result.current.setOrderType("limit"); result.current.editSize("1"); result.current.editPrice("4"); });
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.openReview(); await vi.advanceTimersByTimeAsync(60_000); });
  await act(async () => { finish(assertion); await pending; });
  expect(submitLimitOrder).not.toHaveBeenCalled(); expect(abandonLimitOrder).toHaveBeenCalledOnce();
  expect(result.current.error).toMatch(/expired/i);
  // Nothing was funded, so the ticket takes a fresh Review.
  await act(() => result.current.openReview());
  expect(prepareLimitOrder).toHaveBeenCalledTimes(2);
});

it("returns preparation that expires at the exact cutoff to the populated ticket without opening ID", async () => {
  vi.useFakeTimers();
  vi.mocked(prepareLimitOrder).mockResolvedValue({ review: limitReview(new Date(Date.now()).toISOString()), options });
  vi.mocked(abandonLimitOrder).mockResolvedValue({ ok: true });
  const { result } = hook();
  act(() => { result.current.setOrderType("limit"); result.current.editSize("1"); result.current.editPrice("4"); });
  await act(() => result.current.openReview());
  expect(startAuthentication).not.toHaveBeenCalled();
  expect(abandonLimitOrder).toHaveBeenCalledOnce();
  expect(result.current.quantity).toBe("1"); expect(result.current.price).toBe("4");
  expect(result.current.error).toMatch(/expired/i);
});

it("keeps uncertain funding in Orders recovery without abandoning or signing it again", async () => {
  vi.mocked(prepareLimitOrder).mockResolvedValue({ review: limitReview(), options });
  vi.mocked(startAuthentication).mockResolvedValue(assertion); vi.mocked(submitLimitOrder).mockRejectedValueOnce(new Error("Outcome unknown"));
  const { result } = hook();
  act(() => { result.current.setOrderType("limit"); result.current.editSize("1"); result.current.editPrice("4"); });
  await act(() => result.current.openReview());
  expect(result.current.error).toMatch(/Orders/);
  await act(() => result.current.openReview());
  expect(prepareLimitOrder).toHaveBeenCalledOnce(); expect(startAuthentication).toHaveBeenCalledOnce(); expect(submitLimitOrder).toHaveBeenCalledOnce();
  expect(abandonLimitOrder).not.toHaveBeenCalled();
});

it("opens ID directly and blocks repeat funding after a lost receipt", async () => {
  vi.mocked(prepareLimitOrder).mockResolvedValue({ review: limitReview(), options });
  vi.mocked(startAuthentication).mockResolvedValueOnce(assertion);
  let fail!: (reason: Error) => void; vi.mocked(submitLimitOrder).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  render(<QueryClientProvider client={clients.at(-1)!}><OrderTicketForm account={account} marketPrice={4} signIn={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("tab", { name: "Limit" })); fireEvent.change(screen.getByLabelText("Size"), { target: { value: "1" } }); fireEvent.change(screen.getByLabelText("Price (USDC)"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(await screen.findByRole("button", { name: "Submitting…" })).toBeDisabled();
  expect(previewLimitOrder).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(() => fail(new Error("Transport interrupted")));
  expect(await screen.findByText(/Funding could not be confirmed.*Orders/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Check Orders" })).toBeDisabled();
});

it("accepts a limit review without an exposed funding deadline in the direct flow", async () => {
  const review = executableLimitReview.parse({ ...limitReview(), fundingExpiresAt: undefined });
  vi.mocked(prepareLimitOrder).mockResolvedValue({ review, options });
  vi.mocked(startAuthentication).mockResolvedValue(assertion);
  vi.mocked(submitLimitOrder).mockResolvedValue({ order: {} } as never);
  const { result } = hook();
  act(() => { result.current.setOrderType("limit"); result.current.editSize("1"); result.current.editPrice("4"); });
  await act(() => result.current.openReview());
  expect(startAuthentication).toHaveBeenCalledOnce();
  expect(submitLimitOrder).toHaveBeenCalledOnce();
  expect(result.current.quantity).toBe("");
  const toastId = vi.mocked(toast.loading).mock.calls.at(-1)![1]!.id;
  expect(toast.loading).toHaveBeenCalledWith(TOAST_MESSAGES.orderSubmitting, { id: toastId });
  expect(toast.success).toHaveBeenCalledWith(TOAST_MESSAGES.limitOrderSubmitted, { id: toastId });
});

it("prevents duplicate direct reviews while ID is open and abandons explicit cancellation", async () => {
  vi.mocked(prepareLimitOrder).mockResolvedValue({ review: limitReview(), options });
  vi.mocked(abandonLimitOrder).mockResolvedValue({ ok: true });
  let cancel!: (error: Error) => void;
  vi.mocked(startAuthentication).mockImplementation(() => new Promise((_resolve, reject) => { cancel = reject; }));
  const { result } = hook();
  act(() => { result.current.setOrderType("limit"); result.current.editSize("1"); result.current.editPrice("4"); });
  let pending!: Promise<void>;
  act(() => { pending = result.current.openReview(); });
  await waitFor(() => expect(startAuthentication).toHaveBeenCalledOnce());
  await act(() => result.current.openReview());
  expect(prepareLimitOrder).toHaveBeenCalledOnce();
  await act(async () => { cancel(new DOMException("Cancelled", "NotAllowedError")); await pending; });
  expect(abandonLimitOrder).toHaveBeenCalledOnce();
  expect(submitLimitOrder).not.toHaveBeenCalled();
  expect(result.current.quantity).toBe("1"); expect(result.current.price).toBe("4");
});
it("retrieves an opaque ID completion even if funding expires after submission", async () => {
  const deadline = new Date(Date.now() + 60_000).toISOString();
  vi.mocked(prepareLimitOrder).mockResolvedValue({ review: limitReview(deadline), options });
  vi.mocked(startAuthentication).mockImplementation(async () => { vi.spyOn(Date, "now").mockReturnValue(Date.parse(deadline) + 1); return { id: "receipt", dyaApproval: "done" } as never; });
  vi.mocked(submitLimitOrder).mockResolvedValue({ order: {} } as never);
  const { result } = hook();
  act(() => { result.current.setOrderType("limit"); result.current.editSize("1"); result.current.editPrice("4"); });
  await act(() => result.current.openReview());
  expect(submitLimitOrder).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});

it("retains the attempt and locks editing until cancelled preparation is safely abandoned", async () => {
  vi.mocked(prepareLimitOrder).mockResolvedValue({ review: limitReview(), options });
  vi.mocked(startAuthentication).mockRejectedValue(new DOMException("Cancelled", "NotAllowedError"));
  vi.mocked(abandonLimitOrder).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ok: true });
  render(<QueryClientProvider client={clients.at(-1)!}><OrderTicketForm account={account} marketPrice={4} signIn={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("tab", { name: "Limit" }));
  fireEvent.change(screen.getByLabelText("Size"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Price (USDC)"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  const retry = await screen.findByRole("button", { name: "Retry cancellation" });
  expect(screen.getByLabelText("Size")).toBeDisabled();
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByRole("button", { name: "Review" })).toBeEnabled());
  expect(abandonLimitOrder).toHaveBeenCalledTimes(2);
  expect(abandonLimitOrder).toHaveBeenNthCalledWith(2, vi.mocked(abandonLimitOrder).mock.calls[0][0]);
  expect(startAuthentication).toHaveBeenCalledOnce();
  expect(submitLimitOrder).not.toHaveBeenCalled();
});
it("retains the same request reference after a preparation failure without asking for a signature", async () => {
  vi.mocked(prepareLimitOrder).mockRejectedValue(new Error("Provider temporarily unavailable"));
  const { result } = hook();
  act(() => { result.current.setOrderType("limit"); result.current.editSize("1"); result.current.editPrice("4"); });
  await act(() => result.current.openReview());
  const reference = result.current.limitRequestId;
  await act(() => result.current.openReview());
  expect(prepareLimitOrder).toHaveBeenNthCalledWith(2, expect.objectContaining({ requestId: reference }));
  expect(startAuthentication).not.toHaveBeenCalled();
});


it("places enum-classified minimum errors beneath Size and clears them on correction", async () => {
  const { RemoteRequestError } = await import("@/lib/near/http/request");
  const { ErrorCode } = await import("@/lib/near/domain/errors");
  vi.mocked(prepareLimitOrder).mockRejectedValue(new RemoteRequestError("Minimum order value is $0.10", ErrorCode.LimitOrderAmountTooSmall));
  render(<OrderTicketForm account={account} marketPrice={4} signIn={vi.fn()} />, { wrapper });
  fireEvent.click(screen.getByRole("tab", { name: "Limit" }));
  fireEvent.change(screen.getByLabelText("Price (USDC)"), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText("Size", { exact: true }), { target: { value: "0.01" } });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Minimum order value is $0.10"));
  expect(screen.getByLabelText("Size", { exact: true })).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Size", { exact: true })).toHaveAttribute("aria-describedby", "order-size-error");
  expect(screen.getByRole("alert").tagName).toBe("P");
  fireEvent.change(screen.getByLabelText("Size", { exact: true }), { target: { value: "1" } });
  expect(screen.queryByText("Minimum order value is $0.10")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Size", { exact: true })).not.toHaveAttribute("aria-invalid");
  expect(startAuthentication).not.toHaveBeenCalled();
});

it.each([
  ["INVALID_ASSET_QUANTITY", "size", "Provider size correction"],
  ["INSUFFICIENT_INTENTS_BALANCE_FOR_THIS_LIMIT_ORDER", "size", "Provider balance correction"],
  ["POSITIVE_LIMIT_VALUE_REQUIRED", "price", "Provider price correction"],
] as const)("routes %s beneath its field using the enum", async (code, field, message) => {
  const { RemoteRequestError } = await import("@/lib/near/http/request");
  const { ErrorCode } = await import("@/lib/near/domain/errors");
  const parsed = Object.values(ErrorCode).find(value => value === code)!;
  vi.mocked(prepareLimitOrder).mockRejectedValue(new RemoteRequestError(message, parsed));
  render(<OrderTicketForm account={account} marketPrice={4} signIn={vi.fn()} />, { wrapper });
  fireEvent.click(screen.getByRole("tab", { name: "Limit" }));
  fireEvent.change(screen.getByLabelText("Price (USDC)"), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText("Size", { exact: true }), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(message));
  expect(screen.getByRole("alert").tagName).toBe("P");
  expect(screen.getByLabelText(field === "size" ? "Size" : "Price (USDC)", { exact: true })).toHaveAttribute("aria-describedby", `order-${field}-error`);
});

it("shows local invalid size and price beneath their respective inputs", () => {
  render(<OrderTicketForm account={account} marketPrice={4} signIn={vi.fn()} />, { wrapper });
  fireEvent.click(screen.getByRole("tab", { name: "Limit" }));
  fireEvent.change(screen.getByLabelText("Price (USDC)"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("Size", { exact: true }), { target: { value: "0" } });
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  expect(screen.getAllByRole("alert").every(element => element.tagName === "P")).toBe(true);
  expect(screen.getByLabelText("Size", { exact: true })).toHaveAttribute("aria-describedby", "order-size-error");
  expect(screen.getByLabelText("Price (USDC)")).toHaveAttribute("aria-describedby", "order-price-error");
});

it("keeps unclassified service failures in one persistent alert with an icon", async () => {
  vi.mocked(prepareLimitOrder).mockRejectedValue(new Error("Service failed with size mentioned in its message"));
  render(<OrderTicketForm account={account} marketPrice={4} signIn={vi.fn()} />, { wrapper });
  fireEvent.click(screen.getByRole("tab", { name: "Limit" }));
  fireEvent.change(screen.getByLabelText("Price (USDC)"), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText("Size", { exact: true }), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Service failed"));
  expect(screen.getByRole("alert")).toHaveAttribute("data-slot", "alert");
  expect(screen.getByRole("alert").querySelector("svg")).not.toBeNull();
  expect(screen.getByLabelText("Size", { exact: true })).not.toHaveAttribute("aria-invalid");
});

it("suggests the selected token minimum without changing the entered draft", async () => {
  const { RemoteRequestError, ErrorCode } = await import("@/lib/near/domain/errors");
  const pricedPair = { ...DEFAULT_PAIR,
    base: { ...DEFAULT_PAIR.base, price: "4.73", priceUpdatedAt: new Date().toISOString() },
    quote: { ...DEFAULT_PAIR.quote, price: "0.999662", priceUpdatedAt: new Date().toISOString() },
  };
  vi.mocked(prepareLimitOrder).mockRejectedValue(new RemoteRequestError("Amount too small", ErrorCode.LimitOrderAmountTooSmall, "0.10"));
  const { result } = renderHook(() => useOrderTicket(account, 4, pricedPair), { wrapper });
  act(() => { result.current.setOrderType("limit"); result.current.editPrice("4"); });
  act(() => result.current.changeSizeUnit("quote"));
  act(() => result.current.editSize("0.1"));
  const quantity = result.current.quantity;
  await act(() => result.current.openReview());
  expect(result.current.sizeError).toBe("Amount too small. Try 0.11 USDC or more.");
  expect(result.current.quoteAmount).toBe("0.1");
  expect(result.current.quantity).toBe(quantity);
  act(() => result.current.changeSizeUnit("base"));
  expect(result.current.sizeError).toBe("Amount too small. Try 0.026 NEAR or more.");
  expect(result.current.quantity).toBe(quantity);
  expect(startAuthentication).not.toHaveBeenCalled();
});
