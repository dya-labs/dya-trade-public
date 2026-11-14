import { toast } from "@dya/ui/lib/toast";
vi.mock("@dya/ui/lib/toast", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WalletRecovery } from "../../id/components/wallet-recovery";
const mocks = vi.hoisted(() => ({ connect: vi.fn(), register: vi.fn(), replacement: vi.fn(), recover: vi.fn(), sign: vi.fn(), authenticate: vi.fn(), startRegistration: vi.fn(), authorize: vi.fn(), approve: vi.fn(), enroll: vi.fn() }));
vi.mock("../../id/lib/recovery-client", () => ({ connectRecoveryWallet: mocks.connect, recoveryClient: { register: mocks.register, replacement: mocks.replacement, recover: mocks.recover, authorize: mocks.authorize, approve: mocks.approve, enroll: mocks.enroll } }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: mocks.authenticate, startRegistration: mocks.startRegistration }));
afterEach(() => vi.resetAllMocks());
it("requires_wallet_and_verified_replacement_before_signing_and_refreshes_only_on_done", async () => {
  const complete = vi.fn();
  mocks.connect.mockResolvedValue({ address: "0x1111111111111111111111111111111111111111", chainId: 1, sign: mocks.sign });
  mocks.register.mockResolvedValue({ challenge: "real-server-challenge" });
  mocks.startRegistration.mockResolvedValue({ id: "replacement" });
  mocks.replacement.mockResolvedValue({ message: "server-bound replacement proof", expiresAt: Date.now() + 300000 });
  mocks.sign.mockResolvedValue("proof-signature"); mocks.recover.mockResolvedValue({ ok: true });
  render(<WalletRecovery mode="recover" onComplete={complete} onCancel={() => {}} />);
  expect(screen.getByRole("button", { name: "Connect recovery wallet" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Recovery ID"), { target: { value: "saved-account" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  fireEvent.click(await screen.findByRole("button", { name: "Create replacement passkey" }));
  fireEvent.click(await screen.findByRole("button", { name: "Sign and recover" }));
  await screen.findByText("Account access restored");
  expect(mocks.register).toHaveBeenCalledWith("saved-account", "0x1111111111111111111111111111111111111111", 1);
  expect(mocks.replacement).toHaveBeenCalledWith({ id: "replacement" });
  expect(mocks.sign).toHaveBeenCalledWith("server-bound replacement proof");
  expect(mocks.recover).toHaveBeenCalledWith("proof-signature");
  expect(complete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(complete).toHaveBeenCalledOnce();
});
it("cancelled_passkey_returns_to_a_retryable_start_without_reporting_success", async () => {
  mocks.connect.mockResolvedValue({ address: "0x1111111111111111111111111111111111111111", chainId: 1 });
  mocks.register.mockResolvedValue({ challenge: "test" });
  mocks.startRegistration.mockRejectedValue(new DOMException("Cancelled", "NotAllowedError"));
  render(<WalletRecovery mode="recover" recoveryId="saved-account" onComplete={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  fireEvent.click(await screen.findByRole("button", { name: "Create replacement passkey" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Confirmation cancelled"));
  expect(screen.getByRole("button", { name: "Connect recovery wallet" })).toBeEnabled();
  expect(mocks.recover).not.toHaveBeenCalled();
});
it("expired_proof_never_prompts_wallet_or_submits_recovery", async () => {
  mocks.connect.mockResolvedValue({ address: "0x1111111111111111111111111111111111111111", chainId: 1, sign: mocks.sign });
  mocks.register.mockResolvedValue({ challenge: "test" }); mocks.startRegistration.mockResolvedValue({ id: "replacement" });
  mocks.replacement.mockResolvedValue({ message: "expired", expiresAt: 1 });
  render(<WalletRecovery mode="recover" recoveryId="saved-account" onComplete={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  fireEvent.click(await screen.findByRole("button", { name: "Create replacement passkey" }));
  fireEvent.click(await screen.findByRole("button", { name: "Sign and recover" }));
  await screen.findByText("Recovery request expired. Start again.");
  expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.recover).not.toHaveBeenCalled();
});

function configureLocal() {
  mocks.connect.mockResolvedValue({ address: "0x1111111111111111111111111111111111111111", chainId: 1, sign: mocks.sign });
  mocks.register.mockResolvedValue({ challenge: "replacement" }); mocks.startRegistration.mockResolvedValue({ id: "replacement" });
  mocks.authorize.mockResolvedValue({ challenge: "primary" }); mocks.authenticate.mockResolvedValue({ id: "primary" });
  const proof = { message: "synthetic server-bound local proof", expiresAt: Date.now() + 60000 };
  mocks.replacement.mockResolvedValue(proof); mocks.approve.mockResolvedValue(proof);
  mocks.sign.mockResolvedValue("synthetic-signature"); mocks.recover.mockResolvedValue({ ok: true }); mocks.enroll.mockResolvedValue({ recoveryId: "synthetic-enrolled-id" });
}
async function reachSigning(mode: "enroll" | "recover", complete = vi.fn(async () => {})) {
  render(<WalletRecovery mode={mode} recoveryId="synthetic-recovery-id" onComplete={complete} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  fireEvent.click(await screen.findByRole("button", { name: mode === "enroll" ? "Approve with passkey" : "Create replacement passkey" }));
  return screen.findByRole("button", { name: mode === "enroll" ? "Sign and enroll" : "Sign and recover" });
}
it.each(["enroll", "recover"] as const)("shows a failed host continuation after local %s completion and retries without repeating recovery", async mode => {
  configureLocal();
  const complete = vi.fn().mockRejectedValueOnce(new Error("Synthetic dashboard refresh failed")).mockResolvedValue(undefined);
  fireEvent.click(await reachSigning(mode, complete));
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  expect(await screen.findByText("Synthetic dashboard refresh failed")).toBeVisible();
  expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Connect recovery wallet" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(complete).toHaveBeenCalledTimes(2);
  expect(mocks.sign).toHaveBeenCalledOnce();
  expect(mode === "enroll" ? mocks.enroll : mocks.recover).toHaveBeenCalledOnce();
});
it("recovers a rejected wallet connection without creating or signing a replacement", async () => {
  configureLocal();
  mocks.connect.mockRejectedValueOnce(new Error("Synthetic wallet connection declined"));
  render(<WalletRecovery mode="recover" recoveryId="synthetic-recovery-id" onComplete={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  expect(await screen.findByText("Synthetic wallet connection declined")).toBeVisible();
  expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  expect(await screen.findByRole("button", { name: "Create replacement passkey" })).toBeEnabled();
  expect(screen.queryByText("Synthetic wallet connection declined")).toBeNull();
});
it("blocks expired enrollment proof before requesting a wallet signature", async () => {
  configureLocal(); mocks.approve.mockResolvedValueOnce({ message: "synthetic expired proof", expiresAt: 1 });
  fireEvent.click(await reachSigning("enroll"));
  expect(await screen.findByText("Recovery request expired. Start again.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Connect recovery wallet" })).toBeEnabled();
  expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.enroll).not.toHaveBeenCalled();
});
it("resets a declined wallet signature without claiming recovery success", async () => {
  configureLocal(); mocks.sign.mockRejectedValueOnce(new Error("Synthetic signature declined"));
  fireEvent.click(await reachSigning("recover"));
  expect(await screen.findByText("Synthetic signature declined")).toBeVisible();
  expect(screen.getByRole("button", { name: "Connect recovery wallet" })).toBeEnabled();
  expect(screen.queryByText("Account access restored")).toBeNull(); expect(mocks.recover).not.toHaveBeenCalled();
});
