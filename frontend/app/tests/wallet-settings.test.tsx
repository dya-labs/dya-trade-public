import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@dya/ui/components/theme-provider";
import { WalletSettings } from "../components/near/wallet-settings";

beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.removeItem("theme"); document.documentElement.classList.remove("light", "dark"); });
it("stays dark despite a saved light preference and exposes no theme controls", async () => {
  localStorage.setItem("theme", "light");
  render(<ThemeProvider><WalletSettings busy={false} onSignOut={vi.fn()} /></ThemeProvider>);
  await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
  expect(screen.queryByText("Theme")).toBeNull();
  expect(screen.queryByText("Preferences")).toBeNull();
});
it("keeps account management external and sign out disabled while busy", () => {
  const onSignOut=vi.fn();
  render(<ThemeProvider><WalletSettings idOrigin="http://localhost:3101" busy onSignOut={onSignOut} /></ThemeProvider>);
  expect(screen.getByRole("link", { name: "Manage account in Dya ID" })).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(onSignOut).not.toHaveBeenCalled();
});
