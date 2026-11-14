import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WalletPageHeader } from "../../id/components/wallet-page-header";
afterEach(cleanup);
it("opens a sign-out action without signing out until it is selected", async () => {
  const signOut = vi.fn();
  render(<WalletPageHeader title="Assets" avatarSeed="synthetic-wallet" onSignOut={signOut} />);
  expect(screen.getByRole("heading", { name: "Assets" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
  expect(signOut).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
  expect(signOut).toHaveBeenCalledOnce();
});
it("renders a deterministic local avatar for the same identity without remote images", () => {
  const first = render(<WalletPageHeader avatarSeed="synthetic-wallet" onSignOut={vi.fn()} />);
  const gradient = first.container.querySelector("linearGradient")!;
  const signature = { rotation: gradient.getAttribute("gradientTransform"), stops: [...gradient.querySelectorAll("stop")].map(stop => [stop.getAttribute("offset"), stop.getAttribute("stop-color")]) };
  expect(first.container.querySelector("img")).toBeNull();
  first.unmount();
  const next = render(<WalletPageHeader avatarSeed="synthetic-wallet" onSignOut={vi.fn()} />);
  const again = next.container.querySelector("linearGradient")!;
  expect({ rotation: again.getAttribute("gradientTransform"), stops: [...again.querySelectorAll("stop")].map(stop => [stop.getAttribute("offset"), stop.getAttribute("stop-color")]) }).toEqual(signature);
});

it("keeps profile identity in Settings and shows only the real Main wallet", async () => {
  render(<WalletPageHeader accountName="Personal" avatarSeed="synthetic-wallet" accountValue="240.56" onSignOut={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
  const row = await screen.findByRole("menuitem", { name: "Use Main" });
  expect(row).toHaveAttribute("aria-current", "true");
  expect(row).toHaveTextContent("240.56");
  expect(screen.queryByRole("menuitem", { name: /Create account/ })).toBeNull();
  expect(screen.queryByText("Personal")).toBeNull();
});
it("shows unavailable value and a flagged setup preview instead of fake Trading wallets", async () => {
  render(<WalletPageHeader tradingSetupEnabled onSignOut={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
  expect(await screen.findByRole("menuitem", { name: "Use Main" })).toHaveTextContent("—");
  expect(screen.getByRole("menuitem", { name: "Create account" })).toHaveAttribute("href", "/new");
  expect(screen.queryByRole("menuitem", { name: /Use.*Trading/ })).toBeNull();
});
it("shows the private profile name in Settings and preserves recovery and sign-out", async () => {
  const signOut = vi.fn();
  render(<WalletPageHeader accountName="Personal" onSignOut={signOut} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(await screen.findByText("Personal")).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Recovery wallet" })).toHaveAttribute("href", "/recovery");
  fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
  expect(signOut).toHaveBeenCalledOnce();
});

it("lists only verified Trading metadata and links both wallets to separate views", async () => {
 render(<WalletPageHeader tradingSetupEnabled tradingWallet={{id:"verified-wallet",controllerId:"controller.near"}} selectedWallet="trading" accountValue="12" onSignOut={vi.fn()} />);
 fireEvent.click(screen.getByRole("button", {name:"Switch account"}));
 const trading=await screen.findByRole("menuitem",{name:"Use Main Trading"});
 expect(trading).toHaveAttribute("href","/");expect(trading).toHaveAttribute("aria-current","true");
 expect(screen.getByRole("menuitem",{name:"Use Main"})).toHaveAttribute("href","/");
 expect(screen.getByRole("menuitem",{name:"Use Main"})).not.toHaveAttribute("aria-current");
 expect(trading).not.toHaveTextContent("12");expect(trading).toHaveTextContent("—");
 expect(screen.getByRole("menuitem",{name:"Create account"})).toBeInTheDocument();
});

it("keeps Create account available with multiple named Trading wallets", async () => {
 render(<WalletPageHeader tradingSetupEnabled tradingWallets={[{id:"a",name:"Scalping",controllerId:"c"},{id:"b",name:"Long term",controllerId:"c"}]} tradingWallet={{id:"b",name:"Long term",controllerId:"c"}} selectedWallet="trading" onSignOut={vi.fn()} />);
 fireEvent.click(screen.getByRole("button",{name:"Switch account"}));
 expect(await screen.findByRole("menuitem",{name:"Use Scalping Trading"})).toHaveAttribute("href","/");
 expect(screen.getByRole("menuitem",{name:"Use Long term Trading"})).toHaveAttribute("aria-current","true");
 expect(screen.getByRole("menuitem",{name:"Create account"})).toHaveAttribute("href","/new");
});
