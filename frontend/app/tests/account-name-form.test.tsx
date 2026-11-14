import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AccountNameForm } from "../../id/components/account-name-form";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("removes whitespace and submits the editable private name", () => {
  const submit = vi.fn();
  render(<AccountNameForm busy={false} onSubmit={submit} />);
  const input = screen.getByRole("textbox", { name: "Name" });
  fireEvent.change(input, { target: { value: "My account" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(submit).toHaveBeenCalledWith("Myaccount");
});

it("disables the name field while registration is pending", () => {
  render(<AccountNameForm busy onSubmit={vi.fn()} />);
  expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
});

it("submits Personal when the name is unchanged or cleared", () => {
  const submit = vi.fn();
  render(<AccountNameForm busy={false} onSubmit={submit} />);
  const button = screen.getByRole("button", { name: "Create account" });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(submit).toHaveBeenLastCalledWith("Personal");
  const input = screen.getByRole("textbox", { name: "Name" });
  fireEvent.change(input, { target: { value: "Custom" } });
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(button);
  expect(submit).toHaveBeenLastCalledWith("Personal");
  expect(submit).toHaveBeenCalledTimes(2);
});
