// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { OrderTicket } from "@/components/near/ticket";
import { unlockBalances } from "@/lib/near/client/sign-in";
const state = vi.hoisted(() => ({ required: true, error: "Access required", preview: vi.fn() }));
vi.mock("@/lib/near/client/sign-in", () => ({ unlockBalances: vi.fn(), passkeyError: (e: Error) => e.message }));
vi.mock("@/lib/near/http/trading-client", () => ({ previewMarketOrder: state.preview }));
vi.mock("@dya/wallet-ui/components/near/use-live-balances", () => ({ useLiveBalances: () => ({ balances: null, accessRequired: state.required, balanceError: state.error, loading: false, refresh: vi.fn() }) }));
beforeEach(() => { vi.clearAllMocks(); state.required = true; state.error = "Access required"; });
function setup(suspended = false) { const client = new QueryClient(); const element = <QueryClientProvider client={client}><OrderTicket account={{ id: "test", kind: "passkey" }} signIn={vi.fn()} marketPrice={5} suspended={suspended} /></QueryClientProvider>; return { ...render(element), element }; }
it("confirms access without requesting or submitting a trade, then restores the order button", async () => {
  vi.mocked(unlockBalances).mockImplementationOnce(async () => { state.required = false; state.error = ""; });
  setup();
  fireEvent.change(screen.getByLabelText("Size"), { target: { value: "1" } });
  expect(state.preview).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Continue with passkey" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Continue with passkey" }));
  await waitFor(() => expect(unlockBalances).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Size"), { target: { value: "" } });
  await screen.findByRole("button", { name: "Review" });
});
it("keeps confirmation retryable when cancelled", async () => {
  vi.mocked(unlockBalances).mockRejectedValueOnce(new Error("Confirmation wasn’t completed. Please try again."));
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Continue with passkey" }));
  await screen.findByText("Confirmation wasn’t completed. Please try again.");
  expect(screen.getByRole("button", { name: "Continue with passkey" })).toBeEnabled();
  expect(state.preview).not.toHaveBeenCalled();
});
it("does not show confirmation for ordinary provider failures", () => {
  state.required = false; state.error = "Provider unavailable";
  setup();
  expect(screen.queryByRole("button", { name: "Continue with passkey" })).toBeNull();
  expect(screen.getByRole("button", { name: "Retry balance" })).toBeEnabled();
});
it("disables new order entry during an upstream outage instead of a balance error", () => {
  state.required = false; state.error = "Provider unavailable";
  setup(true);
  expect(screen.queryByText("Unable to load balance.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry balance" })).toBeNull();
  expect(screen.getByRole("button", { name: "Trading unavailable" })).toBeDisabled();
  expect(screen.getByLabelText("Size")).toBeDisabled();
  expect(screen.getByRole("tab", { name: "Buy" })).toBeDisabled();
});
it("allows opening the confidential limit ticket", async () => {
  setup();
  const tab = screen.getByRole("tab", { name: "Limit" });
  expect(tab).toBeEnabled();
  fireEvent.click(tab);
  await waitFor(() => expect(tab).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByLabelText("Price (USDC)")).toBeInTheDocument();
  const week = screen.getByRole("button", { name: "7d" });
  fireEvent.click(week);
  expect(week).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "24h" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(week);
  expect(week).toHaveAttribute("aria-pressed", "true");
});
