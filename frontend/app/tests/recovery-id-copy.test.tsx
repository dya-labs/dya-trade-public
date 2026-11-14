import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecoveryId } from "../../id/components/wallet-recovery-id";
const value = "synthetic-recovery-id-do-not-use", writeText = vi.fn();
let original: PropertyDescriptor | undefined;
beforeEach(() => { original = Object.getOwnPropertyDescriptor(navigator, "clipboard");writeText.mockReset().mockResolvedValue(undefined);Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } }); });
afterEach(() => { vi.useRealTimers();if (original) Object.defineProperty(navigator, "clipboard", original);else Reflect.deleteProperty(navigator, "clipboard"); });
async function copy() { await act(async () => { fireEvent.click(screen.getByRole("button")); }); }
it("copies the exact recovery ID", async () => {
  render(<RecoveryId value={value} />);await copy();expect(writeText).toHaveBeenCalledExactlyOnceWith(value);expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
});
it.each(["denied", "unavailable"])("a %s clipboard leaves an actionable manual-copy fallback", async mode => {
  if (mode === "denied") writeText.mockRejectedValueOnce(new Error("Denied"));
  else Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  render(<RecoveryId value={value} />);await copy();
  expect(screen.getByRole("alert")).toHaveTextContent("Unable to copy recovery ID. Select and copy it manually.");expect(screen.getByLabelText("Recovery ID")).toHaveValue(value);expect(screen.getByRole("button", { name: "Copy recovery ID" })).toBeEnabled();
});
it("repeat copies renew temporary feedback for two seconds", async () => {
  vi.useFakeTimers();render(<RecoveryId value={value} />);await copy();act(() => vi.advanceTimersByTime(1500));await copy();
  act(() => vi.advanceTimersByTime(501));expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
  act(() => vi.advanceTimersByTime(1499));expect(screen.getByRole("button", { name: "Copy recovery ID" })).toBeVisible();
});
it("retrying after a denied copy clears the error on success", async () => {
  writeText.mockRejectedValueOnce(new Error("Denied"));render(<RecoveryId value={value} />);await copy();
  expect(screen.getByRole("alert")).toBeVisible();await copy();
  expect(writeText).toHaveBeenNthCalledWith(2, value);expect(screen.queryByRole("alert")).not.toBeInTheDocument();expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
});
it("a changed recovery ID does not inherit an earlier copied confirmation", async () => {
  const view = render(<RecoveryId value={value} />);await copy();view.rerender(<RecoveryId value="different-synthetic-id" />);
  expect(screen.getByRole("button", { name: "Copy recovery ID" })).toBeVisible();expect(screen.getByLabelText("Recovery ID")).toHaveValue("different-synthetic-id");
});
it("an old pending copy cannot confirm the current recovery ID", async () => {
  const pending = Promise.withResolvers<void>();writeText.mockReturnValueOnce(pending.promise);
  const view = render(<RecoveryId value={value} />);await copy();view.rerender(<RecoveryId value="different-synthetic-id" />);await act(async () => { pending.resolve(); });
  expect(screen.getByRole("button", { name: "Copy recovery ID" })).toBeVisible();
});
