import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecipientAddress } from "@dya/wallet-ui/components/near/recipient-address";
const address = "0x1234567890123456789012345678901234567890", writeText = vi.fn(), error = vi.fn();
let original: PropertyDescriptor | undefined;
beforeEach(() => {
  vi.useFakeTimers();writeText.mockReset().mockResolvedValue(undefined);error.mockClear();
  original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<RecipientAddress address={address} onCopyError={error} />);
});
afterEach(() => { vi.useRealTimers();if (original) Object.defineProperty(navigator, "clipboard", original);else Reflect.deleteProperty(navigator, "clipboard"); });
async function copy() { await act(async () => { fireEvent.click(screen.getByRole("button")); }); }
it("copies the exact recipient and expires confirmation after two seconds", async () => {
  await copy();expect(writeText).toHaveBeenCalledExactlyOnceWith(address);expect(error).toHaveBeenLastCalledWith("");
  act(() => vi.advanceTimersByTime(1999));expect(screen.getByRole("button", { name: "Address copied" })).toBeVisible();
  act(() => vi.advanceTimersByTime(1));expect(screen.getByRole("button", { name: "Copy recipient address" })).toBeVisible();
});
it("a repeat copy keeps confirmation for two seconds after the latest success", async () => {
  await copy();act(() => vi.advanceTimersByTime(1500));await copy();
  act(() => vi.advanceTimersByTime(501));expect(screen.getByRole("button", { name: "Address copied" })).toBeVisible();
  act(() => vi.advanceTimersByTime(1499));expect(screen.getByRole("button", { name: "Copy recipient address" })).toBeVisible();
});
it("a failed repeat copy clears stale success while keeping the full address available", async () => {
  await copy();writeText.mockRejectedValueOnce(new Error("Clipboard denied"));await copy();
  expect(screen.getByRole("button", { name: "Copy recipient address" })).toBeVisible();
  expect(error).toHaveBeenLastCalledWith("Unable to copy address. Please copy it manually.");
  expect(screen.getByTitle(address)).toHaveTextContent(address);
});
it("an older failed copy cannot replace the latest successful confirmation", async () => {
  const pending = Promise.withResolvers<void>();writeText.mockReturnValueOnce(pending.promise);
  await copy();await copy();expect(screen.getByRole("button", { name: "Address copied" })).toBeVisible();
  await act(async () => { pending.reject(new Error("Older clipboard denial")); });
  expect(screen.getByRole("button", { name: "Address copied" })).toBeVisible();expect(error).toHaveBeenLastCalledWith("");
});
it("an older successful copy cannot clear the latest failed attempt", async () => {
  const pending = Promise.withResolvers<void>();writeText.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error("Latest denied"));
  await copy();await copy();await act(async () => { pending.resolve(); });
  expect(screen.getByRole("button", { name: "Copy recipient address" })).toBeVisible();expect(error).toHaveBeenLastCalledWith("Unable to copy address. Please copy it manually.");
});
