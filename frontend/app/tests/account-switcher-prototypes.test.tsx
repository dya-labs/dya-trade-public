import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { createAgent } from "@ui-sdk/react/agent";
import { QuietIdentity } from "../stories/wallet/account-switcher/quiet";
import { AccountPill } from "../stories/wallet/account-switcher/pill";
import { AccountPanel } from "../stories/wallet/account-switcher/panel";
import { PanelBare } from "../stories/wallet/account-switcher/panel-bare";
import { PanelSplit } from "../stories/wallet/account-switcher/panel-split";
import { PanelBadge } from "../stories/wallet/account-switcher/panel-badge";
import { PanelInline } from "../stories/wallet/account-switcher/panel-inline";
import { AccountSwitcherExploration, nextAccountPicker } from "../stories/wallet/account-switcher/harness";
import { demoAccounts, nextDemo } from "../stories/wallet/account-switcher/model";

Object.assign(globalThis, { __UI_SDK_STRICT__: true });
Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {} });
Element.prototype.checkVisibility = () => true;
Element.prototype.scrollIntoView = () => {};
Element.prototype.getAnimations = () => [];
Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
document.elementFromPoint = () => null;
document.elementsFromPoint = () => [];
Object.assign(globalThis, { ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });

for (const [name, Component] of [["Quiet identity", QuietIdentity], ["Account pill", AccountPill], ["Account panel", AccountPanel], ["Panel bare", PanelBare], ["Panel split", PanelSplit], ["Panel inline", PanelInline], ["Panel badge", PanelBadge]] as const) {
  test(`${name} switches accounts, restores trigger focus, and opens creation`, async () => {
    const user = userEvent.setup(); const select = vi.fn(); const create = vi.fn();
    render(<Component accounts={demoAccounts} account={demoAccounts[0]} onSelect={select} onCreate={create} />);
    await user.click(name === "Panel badge" ? screen.getByRole("menuitem", { name: "Use Research Trading" }) : name.toLowerCase().includes("panel") ? screen.getByRole("button", { name: "Use Research Trading" }) : screen.getByRole("menuitemradio", { name: /Research/ }));
    expect(select).toHaveBeenCalledWith("research");
    if (name === "Panel badge") await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Use Research Trading" })).not.toBeInTheDocument());
    if (name === "Panel badge") { screen.getByRole("button", { name: "Switch account" }).focus(); await user.keyboard("{ArrowDown}"); }
    else await user.click(screen.getByRole("button", { name: "Switch account" }));
    await user.click(await screen.findByRole(name.toLowerCase().includes("panel") && name !== "Panel badge" ? "button" : "menuitem", { name: name.toLowerCase().includes("panel") ? "Create account" : "Create Trading account" }));
    expect(create).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Switch account" })).toHaveFocus());
  });
  test(`${name} leads with the selected wallet instead of the profile name`, () => {
    render(<Component accounts={demoAccounts} account={demoAccounts[2]} onSelect={vi.fn()} onCreate={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Switch account" });
    expect(trigger).toHaveTextContent("Research");
    expect(trigger).toHaveTextContent("Trading");
    expect(trigger).not.toHaveTextContent("Personal");
  });
  test(`${name} exposes named account controls`, async () => {
    const agent = createAgent();
    render(<Component accounts={demoAccounts} account={demoAccounts[0]} onSelect={vi.fn()} onCreate={vi.fn()} />);
    await act(() => Promise.resolve());
    if (name === "Panel badge") {
      expect(screen.getByRole("menu", { name: "Switch account" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Use Main Standard" })).toHaveAttribute("aria-current", "true");
      return;
    }
    const entries = agent.snapshot();
    expect(entries.map(entry => entry.label)).toContain(name.toLowerCase().includes("panel") ? "Your accounts" : "Switch account");
    for (const entry of entries.filter(entry => !entry.offPage)) expect(entry.label).toBeTruthy();
  });
}

test("picker switches immediately, wraps, and refuses invalid variant indices", () => {
  expect(nextAccountPicker({ index: 2, revision: 0 }, { type: "relative", delta: 1 })).toEqual({ index: 0, revision: 1 });
  expect(nextAccountPicker({ index: 0, revision: 0 }, { type: "select", index: 3 })).toBeUndefined();
});
test("sample creation adds only a local zero-balance account", () => {
  const before = { phase: "accounts" as const, accounts: demoAccounts, selected: "standard" };
  const create = nextDemo(before, { type: "create" })!;
  const result = nextDemo(create, { type: "confirm" })!;
  expect(result.accounts).toHaveLength(4);
  expect(result.accounts[3]).toMatchObject({ type: "Trading", balance: "$0.00" });
  expect(nextDemo(before, { type: "confirm" })).toBeUndefined();
  expect(nextDemo(before, { type: "select", id: "not-created" })).toBeUndefined();
});
test("picker keys preserve URL selection and demo creation is reachable in context", async () => {
  const user = userEvent.setup(); window.history.replaceState(null, "", "/?v=1");
  render(<AccountSwitcherExploration populated={false} />);
  await user.keyboard("3");
  expect(window.location.search).toContain("v=3");
  expect(screen.getByRole("dialog", { name: "Your accounts" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await user.click(screen.getByRole("button", { name: "Add demo Trading account" }));
  expect(screen.getByRole("status")).toHaveTextContent("Demo account added locally");
  expect(screen.getAllByText("Trading 1 · Trading").length).toBeGreaterThan(0);
});

test("one picker click switches variants while a menu is open", async () => {
  const user = userEvent.setup(); window.history.replaceState(null, "", "/?v=1");
  render(<AccountSwitcherExploration />);
  await user.click(screen.getByRole("button", { name: "Pill" }));
  expect(window.location.search).toContain("v=2");
  expect(screen.getByText("Your accounts")).toBeInTheDocument();
});


test("panel refinements preserve the picker and two-line wallet identity", async () => {
  const user = userEvent.setup(); window.history.replaceState(null, "", "/?v=1");
  render(<AccountSwitcherExploration round="panel" />);
  for (const name of ["Bare", "Split", "Inline"]) {
    await user.click(screen.getByRole("button", { name }));
    const trigger = screen.getByRole("button", { name: "Switch account" });
    expect(trigger).toHaveTextContent("Main");
    expect(trigger).toHaveTextContent("Standard");
    expect(screen.getByRole("dialog", { name: "Your accounts" })).toBeInTheDocument();
  }
});


test("Trading gets a glyph badge while Standard stays unbadged", () => {
  const props = { accounts: demoAccounts, onSelect: vi.fn(), onCreate: vi.fn() };
  const view = render(<PanelBadge {...props} account={demoAccounts[0]} />);
  expect(within(screen.getByRole("button", { name: "Switch account" })).queryByTitle("Trading account")).toBeNull();
  expect(within(screen.getByRole("menuitem", { name: "Use Main Standard" })).queryByTitle("Trading account")).toBeNull();
  expect(within(screen.getByRole("menuitem", { name: "Use Main Trading" })).getByTitle("Trading account")).toBeInTheDocument();
  view.rerender(<PanelBadge {...props} account={demoAccounts[1]} />);
  expect(within(screen.getByRole("button", { name: "Switch account" })).getByTitle("Trading account")).toBeInTheDocument();
});


test("badge header and rows omit type subtitles while preserving accessible account types", () => {
  render(<PanelBadge accounts={demoAccounts} account={demoAccounts[0]} onSelect={vi.fn()} onCreate={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: "Switch account" });
  expect(trigger).toHaveTextContent("Main");
  expect(trigger).not.toHaveTextContent("Standard");
  expect(screen.getByRole("menuitem", { name: "Use Main Standard" })).not.toHaveTextContent("Standard");
  expect(screen.getByRole("menuitem", { name: "Use Main Standard" })).toHaveTextContent("$240.56");
  expect(screen.getByRole("menuitem", { name: "Use Main Standard" })).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("menuitem", { name: "Use Main Trading" })).toHaveTextContent("Trading");
});
