import { beforeEach, expect, it, vi } from "vitest";
import { connect, startAuthentication } from "@dya/wallet-sdk";
import { signIn, unlockBalances, passkeyError } from "../lib/near/client/sign-in";
import { prepareConfidentialAccess, unlockConfidentialAccess } from "../lib/near/http/confidential-client";
vi.mock("@dya/wallet-sdk", () => ({ connect: vi.fn(), startAuthentication: vi.fn(async () => ({ id: "approval", dyaApproval: "approval" })) }));
vi.mock("../lib/near/http/confidential-client", () => ({ prepareConfidentialAccess: vi.fn(async () => ({ options: { challenge: "challenge" } })), unlockConfidentialAccess: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const connected = { account: { id: "alice", kind: "passkey" }, passkeyOrigin: "https://id.example" };
it("delegates login and registration to DYA ID and returns the connected session", async () => {
  vi.mocked(connect).mockResolvedValue(connected);
  expect(await signIn("login", vi.fn())).toEqual(connected); await signIn("register", vi.fn());
  expect(connect).toHaveBeenNthCalledWith(1, "login"); expect(connect).toHaveBeenNthCalledWith(2, "register");
  expect(startAuthentication).not.toHaveBeenCalled(); expect(prepareConfidentialAccess).not.toHaveBeenCalled();
});
it("rejects a connection that returns no valid session", async () => {
  vi.mocked(connect).mockResolvedValueOnce(undefined);
  await expect(signIn("login", vi.fn())).rejects.toThrow("Unexpected server response");
});
it("confirms private access through DYA ID and passes its receipt to the submit endpoint", async () => {
  await unlockBalances();
  expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: "challenge" } });
  expect(unlockConfidentialAccess).toHaveBeenCalledWith({ id: "approval", dyaApproval: "approval" });
});
it("preserves hosted provider failures", async () => {
  vi.mocked(connect).mockRejectedValueOnce(new Error("provider unavailable"));
  await expect(signIn("login", vi.fn())).rejects.toThrow("provider unavailable");
});
it("provides useful cancellation feedback", () => {
  expect(passkeyError(new DOMException("cancelled", "NotAllowedError"))).toContain("Confirmation wasn’t completed");
});
