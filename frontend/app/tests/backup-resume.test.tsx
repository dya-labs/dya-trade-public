import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BackupPasskey } from "../components/near/backup-passkey";
import { backupAuthorizationOptions, backupRegistrationOptions, verifyBackupRegistration } from "../lib/near/http/account-client";
vi.mock("../lib/near/http/account-client", () => ({ backupAuthorizationOptions: vi.fn(), backupRegistrationOptions: vi.fn(async () => ({ challenge: "registration" })), verifyBackupRegistration: vi.fn(async () => ({ ok: true })), verifyBackupAuthorization: vi.fn(), backupTestOptions: vi.fn(), verifyBackupTest: vi.fn() }));
vi.mock("@dya/wallet-sdk", () => ({ startAuthentication: vi.fn(), startRegistration: vi.fn(async () => ({ dyaApproval: "receipt" })) }));
it("resumes verified backup enrollment after a hosted return without restarting primary authorization", async () => {
  const refresh = vi.fn(async () => {});
  render(<BackupPasskey account={{ id: "account", kind: "passkey", backupEnrollmentUntil: Date.now() + 60000 }} refresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: "Continue backup setup" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(backupAuthorizationOptions).not.toHaveBeenCalled(); expect(backupRegistrationOptions).toHaveBeenCalledOnce();
  expect(verifyBackupRegistration).toHaveBeenCalledWith({ dyaApproval: "receipt" });
});
