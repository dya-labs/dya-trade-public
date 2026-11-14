// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Orders } from "@/components/near/orders";
const state = vi.hoisted(() => ({ fundingState: undefined as string | undefined }));
vi.mock("@/components/near/use-activity", () => ({ useMarketTrades: () => ({ data: [], isSuccess: true }), useOrders: () => ({ isSuccess: true, data: [{ id: "order", state: "created", fundingState: state.fundingState, preview: { side: "buy", quantity: "1", price: "4" }, provider: { fillStatus: "AWAITING_DEPOSIT", depositedAmount: "0", partialFills: [], payoutStatus: "NOT_STARTED" } }] }) }));
function setup() { return render(<QueryClientProvider client={new QueryClient()}><Orders accountId="user" /></QueryClientProvider>); }
it("hides unfunded preparation attempts from Orders", () => {
  state.fundingState = undefined;
  setup();
  expect(screen.getByText("No orders yet.")).toBeInTheDocument();
  expect(screen.queryByText("Awaiting deposit")).toBeNull();
});
it("keeps uncertain funding visible for reconciliation", () => {
  state.fundingState = "unknown";
  setup();
  expect(screen.getByText("Checking funding")).toBeInTheDocument();
  expect(screen.queryByText("1 orders")).toBeNull();
});
