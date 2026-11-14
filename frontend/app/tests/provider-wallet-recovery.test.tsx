import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProviderWalletRecovery } from "../../id/components/provider-wallet-recovery";
const mock = vi.hoisted(() => ({ discover: vi.fn(), select: vi.fn(), advance: vi.fn(), status: vi.fn(), sign: vi.fn(), authenticate: vi.fn() }));
vi.mock("../../id/lib/recovery-client", () => ({ connectRecoveryWallet: async () => ({ address: "0x1111111111111111111111111111111111111111", chainId: 1, sign: mock.sign }), providerRecoveryClient: { discover: mock.discover, select: mock.select, advance: mock.advance, status: mock.status } }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: mock.authenticate, startRegistration: vi.fn() }));
afterEach(() => { vi.restoreAllMocks();vi.resetAllMocks();localStorage.clear(); });
it("pending_recovery_checks_status_without_resending_a_key_change", async () => {
  mock.discover.mockResolvedValue({ phase: "recover_add_pending", pending: true });
  mock.status.mockResolvedValue({ phase: "recover_test", options: { challenge: "challenge" } });
  render(<ProviderWalletRecovery mode="recover" recoveryId="saved" onComplete={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  fireEvent.click(await screen.findByRole("button", { name: "Check status" }));
  await screen.findByRole("button", { name: "Test replacement passkey" });
  expect(mock.sign).not.toHaveBeenCalled(); expect(mock.advance).not.toHaveBeenCalled();
});
it("reports_completion_only_after_final_new_passkey_provider_confirmation", async () => {
  const complete = vi.fn();
  mock.discover.mockResolvedValue({ phase: "recover_finish", options: { challenge: "challenge" }, expiresAt: Date.now() + 300000 });
  mock.authenticate.mockResolvedValue({ id: "new" });
  mock.advance.mockResolvedValue({ phase: "complete", recoveryId: "saved" });
  render(<ProviderWalletRecovery mode="recover" recoveryId="saved" onComplete={complete} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  fireEvent.click(await screen.findByRole("button", { name: "Finish with new passkey" }));
  await screen.findByText("Wallet recovered");
  expect(mock.advance).toHaveBeenCalledWith("recover_finish", { id: "new" });
  expect(complete).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Done" })); expect(complete).toHaveBeenCalledOnce();
});

it("discovers_a_single_account_without_an_id_and_continues_automatically", async () => {
  mock.discover.mockResolvedValue({ phase: "recover_discover", message: "ownership proof" }); mock.sign.mockResolvedValue("signature");
  mock.advance.mockResolvedValue({ phase: "recover_select", accounts: [{ id: "found", label: "DYA account found" }] });
  mock.select.mockResolvedValue({ phase: "recover_register", options: {} });
  render(<ProviderWalletRecovery mode="recover" onComplete={() => {}} onCancel={() => {}} />);
  expect(screen.queryByLabelText("Recovery ID")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  fireEvent.click(await screen.findByRole("button", { name: "Find my accounts" }));
  await screen.findByRole("button", { name: "Create replacement passkey" });
  expect(mock.sign).toHaveBeenCalledWith("ownership proof"); expect(mock.select).toHaveBeenCalledWith("found");
});
it("requires_explicit_selection_when_a_wallet_protects_multiple_accounts", async () => {
  mock.discover.mockResolvedValue({ phase: "recover_discover", message: "ownership proof" });
  mock.advance.mockResolvedValue({ phase: "recover_select", accounts: [{ id: "one", label: "DYA account one" }, { id: "two", label: "DYA account two" }] });
  mock.select.mockResolvedValue({ phase: "recover_register", options: {} });
  render(<ProviderWalletRecovery mode="recover" onComplete={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" })); fireEvent.click(await screen.findByRole("button", { name: "Find my accounts" }));
  fireEvent.click(await screen.findByRole("button", { name: "DYA account two" })); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("button", { name: "Create replacement passkey" }); expect(mock.select).toHaveBeenCalledWith("two");
});
it("retries a failed single-account selection without repeating wallet ownership proof", async () => {
  mock.discover.mockResolvedValue({ phase: "recover_discover", message: "ownership proof" });mock.sign.mockResolvedValue("signature");
  mock.advance.mockResolvedValue({ phase: "recover_select", accounts: [{ id: "found", label: "DYA account found" }] });
  mock.select.mockRejectedValueOnce(new Error("Synthetic selection unavailable")).mockResolvedValueOnce({ phase: "recover_register", options: {} });
  render(<ProviderWalletRecovery mode="recover" onComplete={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));fireEvent.click(await screen.findByRole("button", { name: "Find my accounts" }));
  expect(await screen.findByText("Synthetic selection unavailable")).toBeVisible();
  expect(screen.getByRole("button", { name: "DYA account found" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));await screen.findByRole("button", { name: "Create replacement passkey" });
  expect(mock.select).toHaveBeenCalledTimes(2);expect(mock.sign).toHaveBeenCalledOnce();expect(mock.advance).toHaveBeenCalledOnce();
});
it.each(["removed", "empty", "retained"])("validates selected recovery account against a %s refreshed list", async mode => {
  const one = { id: "one", label: "DYA account one" }, two = { id: "two", label: "DYA account two" };
  mock.discover.mockResolvedValue({ phase: "recover_select", accounts: [one, two] });
  mock.status.mockResolvedValue({ phase: "recover_select", accounts: mode === "empty" ? [] : mode === "removed" ? [two] : [one, two] });
  mock.select.mockResolvedValue({ phase: "recover_register", options: {} });
  render(<ProviderWalletRecovery mode="recover" onComplete={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));fireEvent.click(await screen.findByRole("button", { name: one.label }));
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  if (mode === "empty") await screen.findByText(/No accounts are linked/);
  else if (mode === "removed") await vi.waitFor(() => expect(screen.queryByRole("button", { name: one.label })).toBeNull());
  else await vi.waitFor(() => expect(mock.status).toHaveBeenCalledOnce());
  const next = await screen.findByRole("button", { name: "Continue" });
  if (mode === "retained") { expect(next).toBeEnabled();expect(screen.getByRole("button", { name: one.label })).toHaveAttribute("aria-pressed", "true");fireEvent.click(next);await screen.findByRole("button", { name: "Create replacement passkey" });expect(mock.select).toHaveBeenCalledWith("one"); }
  else { expect(next).toBeDisabled();fireEvent.click(next);expect(mock.select).not.toHaveBeenCalled(); }
  expect(mock.sign).not.toHaveBeenCalled();expect(mock.advance).not.toHaveBeenCalled();
});

it("preserves pending recovery after a failed status check and retries without a key-change signature", async () => {
  mock.discover.mockResolvedValue({ phase: "recover_add_pending", pending: true });
  mock.status.mockRejectedValueOnce(new Error("Synthetic status unavailable")).mockResolvedValueOnce({ phase: "recover_test", options: { challenge: "replacement" } });
  render(<ProviderWalletRecovery mode="recover" onComplete={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  fireEvent.click(await screen.findByRole("button", { name: "Check status" }));
  expect(await screen.findByText("Synthetic status unavailable")).toBeVisible();
  expect(screen.getByRole("button", { name: "Check status" })).toBeEnabled();
  expect(mock.sign).not.toHaveBeenCalled(); expect(mock.advance).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  expect(await screen.findByRole("button", { name: "Test replacement passkey" })).toBeEnabled();
  expect(screen.queryByText("Synthetic status unavailable")).toBeNull();
});
it("checks an expired provider step without prompting the wallet or submitting its proof", async () => {
  mock.discover.mockResolvedValue({ phase: "recover_add", message: "expired synthetic key change", expiresAt: 1 });
  mock.status.mockResolvedValue({ phase: "recover_resume", options: {} });
  render(<ProviderWalletRecovery mode="recover" onComplete={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  fireEvent.click(await screen.findByRole("button", { name: "Authorize replacement key" }));
  expect(await screen.findByRole("button", { name: "Resume recovery" })).toBeEnabled();
  expect(mock.status).toHaveBeenCalledOnce(); expect(mock.sign).not.toHaveBeenCalled(); expect(mock.advance).not.toHaveBeenCalled();
});
it("shows host continuation failure on completed provider recovery and permits Done retry", async () => {
  mock.discover.mockResolvedValue({ phase: "complete" });
  const complete = vi.fn().mockRejectedValueOnce(new Error("Synthetic continuation failed")).mockResolvedValue(undefined);
  render(<ProviderWalletRecovery mode="recover" onComplete={complete} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  expect(await screen.findByText("Synthetic continuation failed")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(complete).toHaveBeenCalledTimes(2); expect(mock.advance).not.toHaveBeenCalled();
});
it.each(["discover", "status", "advance"])("clears the obsolete credential hint when %s reports recovery complete", async route => {
  localStorage.setItem("dya-id:credential:v1", "synthetic-old-credential");
  mock.discover.mockResolvedValue(route === "discover" ? { phase: "complete" } : { phase: "recover_finish", options: { challenge: "replacement" }, expiresAt: Date.now() + 300000 });
  mock.status.mockResolvedValue({ phase: "complete" });mock.authenticate.mockResolvedValue({ id: "replacement" });mock.advance.mockResolvedValue({ phase: "complete" });
  render(<ProviderWalletRecovery mode="recover" onComplete={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  if (route !== "discover") { await screen.findByRole("button", { name: "Finish with new passkey" });expect(localStorage.getItem("dya-id:credential:v1")).toBe("synthetic-old-credential");fireEvent.click(screen.getByRole("button", { name: route === "status" ? "Check status" : "Finish with new passkey" })); }
  await screen.findByRole("button", { name: "Done" });expect(localStorage.getItem("dya-id:credential:v1")).toBeNull();
  if (route !== "advance") { expect(mock.authenticate).not.toHaveBeenCalled();expect(mock.advance).not.toHaveBeenCalled(); }
});
it("a blocked credential-hint store cannot prevent status-confirmed recovery completion", async () => {
  mock.discover.mockResolvedValue({ phase: "recover_add_pending", pending: true });mock.status.mockResolvedValue({ phase: "complete" });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Synthetic storage denied"); });
  render(<ProviderWalletRecovery mode="recover" onComplete={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));fireEvent.click(await screen.findByRole("button", { name: "Check status" }));
  expect(await screen.findByRole("button", { name: "Done" })).toBeEnabled();expect(screen.queryByText("Synthetic storage denied")).toBeNull();expect(mock.advance).not.toHaveBeenCalled();
});
