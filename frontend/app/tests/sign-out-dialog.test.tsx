import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SignOutDialog } from "@dya/wallet-ui/components/sign-out-dialog";
afterEach(cleanup);
it("cancels confirmation without requesting sign-out", () => {
  const change = vi.fn(), confirm = vi.fn();
  render(<SignOutDialog open onOpenChange={change} busy={false} onConfirm={confirm} />);
  expect(screen.getByRole("heading", { name: "Sign out?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(change).toHaveBeenCalledWith(false);
  expect(confirm).not.toHaveBeenCalled();
});
it("locks dismissal while pending and restores retry after a reported failure", () => {
  const change = vi.fn(), confirm = vi.fn();
  const view = render(<SignOutDialog open onOpenChange={change} busy onConfirm={confirm} />);
  expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
  expect(change).not.toHaveBeenCalled();
  view.rerender(<SignOutDialog open onOpenChange={change} busy={false} error="Sign-out failed. Try again." onConfirm={confirm} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Sign-out failed. Try again.");
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
});
