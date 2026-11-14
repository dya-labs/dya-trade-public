import { AppError, ErrorCode } from "@/lib/near/domain/errors";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OrderTicket } from "@/components/near/ticket";
import { MARKET_QUOTE_DEBOUNCE_MS } from "@/components/near/use-market-quote";
import type { Snapshot } from "@/lib/near/http/schemas/account";

const api = vi.fn();
vi.mock("@/lib/near/http/trading-client", () => ({ previewMarketOrder: (...args: unknown[]) => api(...args) }));
vi.mock("@dya/wallet-ui/components/near/use-live-balances", () => ({
  useLiveBalances: () => ({
    balances: { assets: [
      { ...DEFAULT_PAIR.base, amount: "2" },
      { ...DEFAULT_PAIR.quote, amount: "10" },
    ] },
    balanceError: "", loading: false,
  }),
}));
const account = { id: "test-account", kind: "passkey" } as Snapshot["account"];
function renderTicket() { return render(<QueryClientProvider client={new QueryClient()}><OrderTicket account={account} signIn={() => {}} marketPrice={5} /></QueryClientProvider>); }
afterEach(() => { vi.useRealTimers(); api.mockReset(); });

it("caps typed percentages at the balance and preserves sizing on invalid edits", async () => {
  vi.useFakeTimers();
  renderTicket();
  const input = screen.getByRole("textbox", { name: "Size percentage input" });
  const slider = screen.getByRole("slider", { name: "Size percentage slider" });
  const size = screen.getByRole("textbox", { name: "Size" });
  fireEvent.change(input, { target: { value: "999" } });
  expect(input).toHaveValue("100");
  expect(slider).toHaveValue("100");
  expect(size).toHaveValue("2");
  for (const value of ["-1", "1.5", "1e2", "1000", "abc"]) {
    fireEvent.change(input, { target: { value } });
    expect(input).toHaveValue("100");
    expect(size).toHaveValue("2");
  }
  fireEvent.change(input, { target: { value: "" } });
  expect(size).toHaveValue("");
  expect(slider).toHaveValue("0");
  fireEvent.blur(input);
  expect(input).toHaveValue("0");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(api).not.toHaveBeenCalled();
});

it.each([
  { mark: 0, direction: 1 }, { mark: 25, direction: 1 },
  { mark: 50, direction: 1 }, { mark: 75, direction: 1 },
  { mark: 25, direction: -1 }, { mark: 50, direction: -1 },
  { mark: 75, direction: -1 }, { mark: 100, direction: -1 },
])("lets keyboard input step away from $mark percent by $direction", ({ mark, direction }) => {
  vi.useFakeTimers();
  renderTicket();
  fireEvent.change(screen.getByRole("textbox", { name: "Size percentage input" }), { target: { value: String(mark) } });
  const slider = screen.getByRole("slider", { name: "Size percentage slider" });
  fireEvent.keyDown(slider, { key: direction > 0 ? "ArrowRight" : "ArrowLeft" });
  // jsdom does not implement range-input keyboard default actions. Supply the
  // native one-step change, then verify the controlled value does not snap back.
  fireEvent.change(slider, { target: { value: String(mark + direction) } });
  expect(slider).toHaveValue(String(mark + direction));
  expect(screen.getByRole("textbox", { name: "Size percentage input" })).toHaveValue(String(mark + direction));
});

it("still snaps pointer drags close to a tick mark without requesting quotes mid-drag", async () => {
  vi.useFakeTimers();
  renderTicket();
  const slider = screen.getByRole("slider", { name: "Size percentage slider" });
  fireEvent.pointerDown(slider);
  fireEvent.change(slider, { target: { value: "24" } });
  expect(slider).toHaveValue("25");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(api).not.toHaveBeenCalled();
});

it("updates locally during a slow drag and quotes once on release", async () => {
  vi.useFakeTimers();
  api.mockResolvedValue({ estimatedOutput: "1", outputSymbol: "wNEAR", principal: "5", inputSymbol: "USDC", minimumOutput: "0.99", shortfall: "0", slippageBps: 100 });
  renderTicket();
  const slider = screen.getByRole("slider", { name: "Size percentage slider" });
  fireEvent.pointerDown(slider);
  fireEvent.change(slider, { target: { value: "25" } });
  expect(screen.getByText("Order value")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Release to quote/ })).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(api).not.toHaveBeenCalled();
  fireEvent.change(slider, { target: { value: "100" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(api).not.toHaveBeenCalled();
  fireEvent.pointerUp(slider);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  // The quick quote and the full-window one, requested together.
  expect(api).toHaveBeenCalledTimes(2);
  expect(api.mock.calls[0][0]).toMatchObject({ quantity: "2", side: "buy" });
  expect(screen.getByText("Order value")).toBeInTheDocument();
});

it("debounces typed percentage and offers retry after a failed quote", async () => {
  vi.useFakeTimers();
  api.mockRejectedValue(new Error("Quote unavailable"));
  renderTicket();
  const input = screen.getByRole("textbox", { name: "Size percentage input" });
  fireEvent.change(input, { target: { value: "25" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(MARKET_QUOTE_DEBOUNCE_MS - 100); });
  // Typing again within the debounce restarts it.
  fireEvent.change(input, { target: { value: "50" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(MARKET_QUOTE_DEBOUNCE_MS - 1); });
  expect(api).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); await vi.advanceTimersByTimeAsync(1); });
  // The quick quote and the full-window one both failed.
  expect(api).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Unable to get a quote. Try again.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  expect(api).toHaveBeenCalledTimes(4);
});

it("shows a recognized liquidity reason instead of the generic quote error", async () => {
  vi.useFakeTimers();
  api.mockRejectedValue(new AppError(ErrorCode.MarketLiquidityUnavailable));
  renderTicket();
  fireEvent.change(screen.getByRole("textbox", { name: "Size percentage input" }), { target: { value: "25" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
  expect(screen.getByText("No liquidity available for this trade.")).toBeInTheDocument();
  expect(screen.queryByText("Unable to get a quote. Try again.")).toBeNull();
});
