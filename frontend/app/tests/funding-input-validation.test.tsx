import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FundingDialog } from "@/components/near/funding-dialog";
import { prepareFunding } from "@/lib/near/http/funding-conversions-client";
import { balances, catalog } from "./fixtures/funding";

vi.mock("@dya/ui/components/dialog-drawer", () => ({ DialogDrawerHeader: "header", DialogDrawerTitle: "h2", DialogDrawerDescription: "p" }));
vi.mock("@dya/wallet-ui/components/near/use-live-balances", () => ({ useBalanceQuery: () => ({ data: balances }) }));
vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: async () => ({ assets: catalog }) }));
vi.mock("@/lib/near/http/funding-conversions-client", () => ({ prepareFunding: vi.fn(), fundingHistory: async () => ({ operations: [] }), fundingStatus: vi.fn(), authorizeFunding: vi.fn(), submitFunding: vi.fn(), cancelFunding: vi.fn() }));
vi.mock("@dya/wallet-sdk", () => ({ startAuthentication: vi.fn() }));
const clients: QueryClient[] = [];
beforeEach(() => { localStorage.setItem("dya:funding-trading-guide:v1:funding-validation", "seen"); vi.clearAllMocks(); vi.stubGlobal("PointerEvent", MouseEvent); });
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
async function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><FundingDialog accountId="funding-validation" onComplete={vi.fn()} /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Show funding breakdown" }));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit USDC on Base" }));
}
it("blocks an oversized selected route without requesting provider quotes", async () => {
  await setup();
  const amount = screen.getByLabelText("USDC · Base");
  fireEvent.change(amount, { target: { value: "2" } });
  expect(amount).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Insufficient balance" })).toBeDisabled();
  expect(prepareFunding).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Max" }));
  expect(amount).toHaveValue("1");
  expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
});
it("validates exact token precision and incomplete decimals before quote preparation", async () => {
  await setup();
  const amount = screen.getByLabelText("USDC · Base");
  for (const value of ["0.0000001", "1.", "01"]){
    fireEvent.change(amount, { target: { value } });
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  }
  fireEvent.change(amount, { target: { value: "0.000001" } });
  expect(amount).not.toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  expect(prepareFunding).not.toHaveBeenCalled();
});
it("does not let an excluded route's invalid amount block the remaining selected route", async () => {
  await setup();
  fireEvent.change(screen.getByLabelText("USDC · Base"), { target: { value: "2" } });
  expect(screen.getByRole("button", { name: "Insufficient balance" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select USDC on Base" }));
  expect(screen.getByLabelText("Selected funding value")).toHaveTextContent("$1.00");
  expect(screen.getByRole("button", { name: "Show funding breakdown" })).toHaveTextContent("Details");
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  expect(prepareFunding).not.toHaveBeenCalled();
});
