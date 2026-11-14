import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { createAgent } from "@ui-sdk/react/agent";
import { TradingActivationPreview } from "@dya/ui/components/trading-activation-preview";
import { nextActivationPreview, activationPreviewView, type ActivationPreviewState } from "@dya/ui/lib/trading-activation-preview";

Element.prototype.checkVisibility = () => true;
Element.prototype.scrollIntoView = () => {};
Element.prototype.getAnimations = () => [];
document.elementFromPoint = () => null;
document.elementsFromPoint = () => [];

test("setup accepts one payment, preserves uncertainty, and never retries an uncertain charge", () => {
  let state: ActivationPreviewState = { phase: "review" };
  state = nextActivationPreview(state, { type: "approve" })!;
  expect(nextActivationPreview(state, { type: "approve" })).toBeUndefined();
  state = nextActivationPreview(state, { type: "unknown" })!;
  expect(activationPreviewView(state).action).toBe("check");
  expect(nextActivationPreview(state, { type: "approve" })).toBeUndefined();
  expect(nextActivationPreview(state, { type: "restart" })).toBeUndefined();
  state = nextActivationPreview(state, { type: "check" })!;
  state = nextActivationPreview(state, { type: "completed" })!;
  expect(state).toEqual({ phase: "activating", step: "account" });
});

test.each(["expired", "refund", "refunded", "uncertain", "reconciling"] as const)("%s cannot enable funding or approve a payment", phase => {
  expect(nextActivationPreview({ phase }, { type: "approve" })).toBeUndefined();
  expect(nextActivationPreview({ phase }, { type: "fund" })).toBeUndefined();
});

test("failure allows refunds only after a known policy failure and does not claim readiness", () => {
  expect(nextActivationPreview({ phase: "activating", step: "payment" }, { type: "failed" })).toBeUndefined();
  const failed = nextActivationPreview({ phase: "activating", step: "policy" }, { type: "failed" })!;
  expect(failed).toEqual({ phase: "refund" });
  expect(nextActivationPreview(failed, { type: "completed" })).toEqual({ phase: "refunded" });
});

test("agent selects Trading; expired quotes refuse payment; Back preserves the choice", async () => {
  const user = userEvent.setup(); const agent = createAgent();
  render(<TradingActivationPreview />);
  expect(agent.snapshot().some(entry => entry.label === "Account type")).toBe(true);
  await act(async () => { const result = await agent.act({ steps: [{ ref: "Account type", action: "setValue", args: ["Trading"] }] }); expect(result.ok).toBe(true); });
  await user.click(screen.getByRole("button", { name: "Review setup cost" }));
  expect(screen.getByRole("heading", { name: "Review setup cost" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("radio", { name: "Trading" })).toHaveAttribute("aria-checked", "true");
  await user.click(screen.getByRole("button", { name: "Review setup cost" }));
  await user.click(screen.getByRole("button", { name: "Preview expired quote" }));
  expect(screen.queryByRole("button", { name: /Simulate payment/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Refresh quote" }));
  expect(screen.getByRole("button", { name: /Simulate payment/ })).toBeEnabled();
});

test.each(["success", "policy-failure"] as const)("simulated %s reaches the correct outcome without network calls", async scenario => {
  vi.useFakeTimers(); const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    render(<TradingActivationPreview scenario={scenario} initialState={{ phase: "activating", step: "payment" }} />);
    for (let i = 0; i < 4; i++) await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getByRole("heading", { name: scenario === "success" ? "Your Trading account is ready" : "Unused payment returned" })).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
    if (scenario === "success") expect(screen.getByRole("button", { name: "Add funds" })).toBeEnabled();
    else expect(screen.queryByRole("button", { name: "Add funds" })).toBeNull();
  } finally { fetcher.mockRestore(); vi.useRealTimers(); }
});
