import { toast } from "@dya/ui/lib/toast";
vi.mock("@dya/ui/lib/toast", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BackupPasskey } from "@/components/near/backup-passkey";
import { backupAuthorizationOptions, backupRegistrationOptions, backupTestOptions, verifyBackupAuthorization, verifyBackupRegistration, verifyBackupTest } from "@/lib/near/http/account-client";
import { startAuthentication, startRegistration } from "@dya/wallet-sdk";
vi.mock("@dya/wallet-ui/lib/near/http/account-client", () => ({ backupAuthorizationOptions: vi.fn(), backupRegistrationOptions: vi.fn(), backupTestOptions: vi.fn(), verifyBackupAuthorization: vi.fn(), verifyBackupRegistration: vi.fn(), verifyBackupTest: vi.fn() }));
vi.mock("@dya/wallet-sdk", () => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
const account = { id: "synthetic-backup-account", kind: "passkey" as const };
const backup = { ...account, backup: { status: "pending_onchain" as const } };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(backupAuthorizationOptions).mockResolvedValue({ challenge: "primary" } as Awaited<ReturnType<typeof backupAuthorizationOptions>>);
  vi.mocked(backupRegistrationOptions).mockResolvedValue({ challenge: "registration" } as Awaited<ReturnType<typeof backupRegistrationOptions>>);
  vi.mocked(backupTestOptions).mockResolvedValue({ challenge: "possession" } as Awaited<ReturnType<typeof backupTestOptions>>);
  vi.mocked(startAuthentication).mockResolvedValue({ id: "synthetic-approval" } as Awaited<ReturnType<typeof startAuthentication>>);
  vi.mocked(startRegistration).mockResolvedValue({ id: "synthetic-registration" } as Awaited<ReturnType<typeof startRegistration>>);
  vi.mocked(verifyBackupAuthorization).mockResolvedValue({ ok: true });
  vi.mocked(verifyBackupRegistration).mockResolvedValue({ ok: true });
  vi.mocked(verifyBackupTest).mockResolvedValue({ ok: true });
});
afterEach(cleanup);
it("authorizes with the primary passkey before registration and reports only local backup setup", async () => {
  const refresh = vi.fn(async () => {});
  render(<BackupPasskey account={account} refresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: "Set up backup passkey" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Backup saved locally. Test it next. On-chain authorization is still required.");
  expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: "primary" } });
  expect(verifyBackupAuthorization).toHaveBeenCalledWith({ id: "synthetic-approval" });
  expect(vi.mocked(verifyBackupAuthorization).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(backupRegistrationOptions).mock.invocationCallOrder[0]);
  expect(verifyBackupRegistration).toHaveBeenCalledWith({ id: "synthetic-registration" });
  expect(vi.mocked(verifyBackupRegistration).mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
  expect(screen.getByText(/backup cannot sign in or control funds/)).toBeVisible();
});
it("requires fresh primary approval when a saved enrollment authorization has expired", async () => {
  render(<BackupPasskey account={{ ...account, backupEnrollmentUntil: Date.now() - 1 }} refresh={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Continue backup setup" }));
  await screen.findByRole("status");
  expect(backupAuthorizationOptions).toHaveBeenCalledOnce();
  expect(verifyBackupAuthorization).toHaveBeenCalledOnce();
});
it("blocks duplicate setup while primary confirmation is pending and shows a loading spinner", async () => {
  let approve!: (value: Awaited<ReturnType<typeof startAuthentication>>) => void;
  vi.mocked(startAuthentication).mockImplementationOnce(() => new Promise(resolve => { approve = resolve; }));
  render(<BackupPasskey account={account} refresh={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Set up backup passkey" }));
  const waiting = await screen.findByRole("button", { name: "Waiting for passkey…" });
  expect(waiting).toBeDisabled();
  expect(waiting.querySelector(".dya-spinner")).not.toBeNull();
  fireEvent.click(waiting);
  expect(backupRegistrationOptions).not.toHaveBeenCalled();
  await act(async () => approve({ id: "synthetic-approval" } as Awaited<ReturnType<typeof startAuthentication>>));
  await screen.findByRole("status");
  expect(backupAuthorizationOptions).toHaveBeenCalledOnce();
});
it.each(["primary", "registration", "possession"] as const)("handles cancelled %s confirmation with a neutral toast and a retryable action", async stage => {
  const cancelled = new DOMException("Opaque device diagnostic", "NotAllowedError");
  if (stage === "registration") vi.mocked(startRegistration).mockRejectedValueOnce(cancelled);
  else vi.mocked(startAuthentication).mockRejectedValueOnce(cancelled);
  const refresh = vi.fn(async () => {});
  render(<BackupPasskey account={stage === "possession" ? backup : account} refresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: stage === "possession" ? "Test backup passkey" : "Set up backup passkey" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Confirmation cancelled"));
  expect(screen.queryByText("Confirmation wasn’t completed")).toBeNull();
  expect(screen.queryByText("Opaque device diagnostic")).toBeNull();
  const retry = screen.getByRole("button", { name: stage === "possession" ? "Test backup passkey" : "Set up backup passkey" });
  expect(retry).toBeEnabled();
  expect(refresh).not.toHaveBeenCalled();
  expect(stage === "possession" ? verifyBackupTest : verifyBackupRegistration).not.toHaveBeenCalled();
  fireEvent.click(retry);
  expect(await screen.findByRole("status")).toHaveTextContent(stage === "possession" ? "Backup possession verified locally" : "Backup saved locally");
  expect(screen.queryByText("Confirmation wasn’t completed")).toBeNull();
});
it("tests a saved backup without registering another and keeps recovery inactive", async () => {
  const refresh = vi.fn(async () => {});
  render(<BackupPasskey account={backup} refresh={refresh} />);
  expect(screen.getByText("Backup saved · Test required")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Test backup passkey" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Backup possession verified locally. Recovery is not active yet.");
  expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: "possession" } });
  expect(verifyBackupTest).toHaveBeenCalledWith({ id: "synthetic-approval" });
  expect(backupRegistrationOptions).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledOnce();
});
it("keeps provider verification failure retryable without claiming possession", async () => {
  vi.mocked(verifyBackupTest).mockRejectedValueOnce(new Error("Synthetic verification unavailable"));
  const refresh = vi.fn(async () => {});
  render(<BackupPasskey account={{ ...backup, backup: { ...backup.backup, testedAt: 1 } }} refresh={refresh} />);
  expect(screen.getByText("Backup tested locally · Pending on-chain authorization")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Test backup passkey" }));
  expect(await screen.findByText("Synthetic verification unavailable")).toBeVisible();
  expect(screen.queryByRole("status")).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Test backup passkey" })).toBeEnabled();
});

it.each(["enrollment", "possession"] as const)("retains committed %s success when the account refresh fails", async stage => {
  const refresh = vi.fn().mockRejectedValueOnce(new Error("Synthetic account refresh unavailable")).mockResolvedValue(undefined);
  render(<BackupPasskey account={stage === "possession" ? backup : account} refresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: stage === "possession" ? "Test backup passkey" : "Set up backup passkey" }));
  expect(await screen.findByRole("status")).toHaveTextContent(stage === "possession" ? "Backup possession verified locally" : "Backup saved locally");
  expect(await screen.findByText("Synthetic account refresh unavailable")).toBeVisible();
  const retry = screen.getByRole("button", { name: "Test backup passkey" });expect(retry).toBeEnabled();
  if(stage === "enrollment") { fireEvent.click(retry);await waitFor(() => expect(verifyBackupTest).toHaveBeenCalledOnce());expect(startRegistration).toHaveBeenCalledTimes(1); }
});
it("does not display a prior account's completed enrollment after the account changes", async () => {
  let finish!: () => void;
  const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<BackupPasskey account={account} refresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: "Set up backup passkey" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  view.rerender(<BackupPasskey account={{ ...account, id: "synthetic-other-account" }} refresh={async () => {}} />);
  await act(async () => finish());
  expect(screen.queryByText(/Backup saved locally/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Set up backup passkey" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Test backup passkey" })).not.toBeInTheDocument();
});

it.each(["primary options", "primary device", "primary verification", "registration options", "registration device", "registration verification", "test options", "test device", "test verification"] as const)("stops backup work after account replacement during %s", async stage => {
  let release!: () => void;const gate = new Promise<void>(resolve => { release = resolve; });
  async function step<T>(name: string, value: T): Promise<T> { if (stage === name) await gate;return value; }
  vi.mocked(backupAuthorizationOptions).mockImplementation(() => step("primary options", { challenge: "primary" } as Awaited<ReturnType<typeof backupAuthorizationOptions>>));
  vi.mocked(startAuthentication).mockImplementation(() => step(stage.startsWith("test") ? "test device" : "primary device", { id: "synthetic" } as Awaited<ReturnType<typeof startAuthentication>>));
  vi.mocked(verifyBackupAuthorization).mockImplementation(() => step("primary verification", { ok: true }));
  vi.mocked(backupRegistrationOptions).mockImplementation(() => step("registration options", { challenge: "registration" } as Awaited<ReturnType<typeof backupRegistrationOptions>>));
  vi.mocked(startRegistration).mockImplementation(() => step("registration device", { id: "synthetic" } as Awaited<ReturnType<typeof startRegistration>>));
  vi.mocked(verifyBackupRegistration).mockImplementation(() => step("registration verification", { ok: true }));
  vi.mocked(backupTestOptions).mockImplementation(() => step("test options", { challenge: "test" } as Awaited<ReturnType<typeof backupTestOptions>>));
  vi.mocked(verifyBackupTest).mockImplementation(() => step("test verification", { ok: true }));
  const refresh = vi.fn(async () => {}), possession = stage.startsWith("test");
  const stages = possession ? ["test options", "test device", "test verification"] : ["primary options", "primary device", "primary verification", "registration options", "registration device", "registration verification"];
  const calls = possession ? [backupTestOptions, startAuthentication, verifyBackupTest, refresh] : [backupAuthorizationOptions, startAuthentication, verifyBackupAuthorization, backupRegistrationOptions, startRegistration, verifyBackupRegistration, refresh];
  const stop = stages.indexOf(stage);
  const view = render(<BackupPasskey account={possession ? backup : account} refresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: possession ? "Test backup passkey" : "Set up backup passkey" }));
  await waitFor(() => expect(calls[stop]).toHaveBeenCalledOnce());
  view.rerender(<BackupPasskey account={{ id: "replacement-account", kind: "passkey" }} refresh={refresh} />);
  await act(async () => { release(); });
  for (const [i,call] of calls.entries()) expect(call).toHaveBeenCalledTimes(i <= stop ? 1 : 0);
  expect(screen.getByRole("button", { name: "Set up backup passkey" })).toBeEnabled();
  expect(screen.queryByRole("status")).toBeNull();
});
