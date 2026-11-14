import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TradeHistory } from "@/components/near/trade-history";
import { OrderHistory } from "@/components/near/order-history";

const state = vi.hoisted(() => ({ query: {} as Record<string, unknown>, retry: vi.fn() }));
vi.mock("@/components/near/use-activity", () => ({ useOrders: () => state.query, useMarketTrades: () => state.query }));
beforeEach(() => { state.retry.mockReset(); state.query = { data: [], isPending: false, refetch: state.retry }; });
for (const [Component, name, empty] of [[TradeHistory, "trade history", "No executions yet."], [OrderHistory, "order history", "No submitted orders yet."]] as const) {
  it(`${name} distinguishes empty from unavailable and retries both sources`, () => {
    const view = render(<Component accountId="demo" />);
    expect(screen.getByText(empty)).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
    state.query = { ...state.query, data: undefined, error: new Error("private upstream") };
    view.rerender(<Component accountId="demo" />);
    expect(screen.getByText(`Couldn’t load ${name}`)).toBeVisible();
    expect(screen.queryByText(empty)).toBeNull();
    expect(screen.queryByText("private upstream")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(state.retry).toHaveBeenCalledTimes(2);
  });
  it(`${name} uses a loading table before data exists`, () => {
    state.query = { ...state.query, data: undefined, isPending: true };
    render(<Component accountId="demo" />);
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(empty)).toBeNull();
  });
}
