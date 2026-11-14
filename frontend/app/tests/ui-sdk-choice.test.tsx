import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { createAgent } from "@ui-sdk/react/agent";
import { ExperimentalChoiceGroup } from "@dya/ui/components/experimental-choice-group";

Object.assign(globalThis, { __UI_SDK_STRICT__: true });
Element.prototype.checkVisibility = () => true;
Element.prototype.scrollIntoView = () => {};
Element.prototype.getAnimations = () => [];
document.elementFromPoint = () => null;
document.elementsFromPoint = () => [];
const choices = [
  { value: "original", label: "Original account", description: "Existing signing flow." },
  { value: "trading", label: "Trading account", description: "Preview only. No wallet is created.", badge: "Preview" },
];

test("keyboard selection reports the selected account and submits its value", async () => {
  const user = userEvent.setup(); const changed = vi.fn();
  render(<form aria-label="Example"><ExperimentalChoiceGroup label="Account type" name="accountType" defaultValue="original" choices={choices} onValueChange={changed} /></form>);
  await user.tab();
  expect(screen.getByRole("radio", { name: "Original account" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("radio", { name: "Trading account" })).toHaveAttribute("aria-checked", "true");
  expect(changed).toHaveBeenCalledWith("trading", expect.objectContaining({ reason: "list-navigation", event: expect.any(KeyboardEvent) }));
  expect(new FormData(screen.getByRole("form", { name: "Example" }) as HTMLFormElement).get("accountType")).toBe("trading");
  await user.click(screen.getByText("Original account"));
  expect(screen.getByRole("radio", { name: "Original account" })).toHaveAttribute("aria-checked", "true");
});

test("disabled choices cannot be selected", async () => {
  const user = userEvent.setup(); const changed = vi.fn();
  render(<ExperimentalChoiceGroup label="Account type" defaultValue="original" choices={choices} disabled onValueChange={changed} />);
  await user.click(screen.getByText("Trading account"));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole("radio", { name: "Original account" })).toHaveAttribute("aria-checked", "true");
});

test("agent can discover and select the isolated example without wallet access", async () => {
  const agent = createAgent(); const changed = vi.fn();
  render(<ExperimentalChoiceGroup label="Account type" defaultValue="original" choices={choices} onValueChange={changed} />);
  expect(agent.snapshot().some(entry => entry.label === "Account type")).toBe(true);
  let result: Awaited<ReturnType<typeof agent.act>> | undefined;
  await act(async () => { result = await agent.act({ steps: [{ ref: "Account type", action: "setValue", args: ["Trading account"] }] }); });
  expect(result?.ok, result?.error?.message).toBe(true);
  expect(screen.getByRole("radio", { name: "Trading account" })).toHaveAttribute("aria-checked", "true");
  expect(changed).toHaveBeenCalledWith("trading", expect.objectContaining({ source: "agent" }));
});

test("server output preserves the selected value and accessible names", () => {
  const html = renderToString(<ExperimentalChoiceGroup label="Account type" defaultValue="original" choices={choices} />);
  expect(html).toContain('role="radiogroup"');
  expect(html).toContain('aria-label="Account type"');
  expect(html).toContain('aria-checked="true"');
  expect(html).toContain("Original account");
  expect(html).toContain("Trading account");
});
