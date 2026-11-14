import { ConfidentialAccessRequired } from "@/lib/near/domain/confidential-access-error";
// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { runConfidential } from "../../../backend/id/src/near/services/confidential-workflow";
import { hash, type State, type StateStore } from "../../../backend/id/src/near/repositories/store";
import type { AccountWorkflowContext } from "../../../backend/id/src/near/services/workflow-context";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), authenticate: vi.fn(), balances: vi.fn(), refresh: vi.fn() }));
vi.mock("../../../backend/id/src/near/auth/passkeys", () => ({ verifyAssertion: mocks.verify }));
vi.mock("../../../backend/id/src/near/auth/intents", () => ({ accountIdentity: () => ({ accountId: "identity" }), encodeAssertion: () => ({ standard: "webauthn" }), payloadChallenge: vi.fn() }));
vi.mock("../../../backend/id/src/near/providers/confidential", () => ({ authenticateConfidential: mocks.authenticate, readConfidentialBalances: mocks.balances, refreshConfidential: mocks.refresh }));
vi.mock("../../../backend/id/src/near/providers/catalog", () => ({ readCatalog: async () => [{ assetId: "token", symbol: "TOKEN", decimals: 6 }] }));
beforeEach(() => {
  vi.stubEnv("CONFIDENTIAL_SESSION_KEY", "11".repeat(32));
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue(2);
  mocks.authenticate.mockResolvedValue({ accessToken: "secret-access", refreshToken: "secret-refresh", expiresIn: 600, refreshExpiresIn: 3600 });
  mocks.balances.mockResolvedValue({ balances: [] });
});
function setup() {
  const session = randomUUID();
  const account = { id: "user", kind: "passkey" as const, publicKey: "key", credentialId: "credential", counter: 1 };
  const state: State = { accounts: { user: account }, sessions: { [hash(session)]: { accountId: "user", expires: Date.now() + 60000 } }, challenges: { [hash("ceremony")]: { purpose: "confidential-auth", accountId: "user", expires: Date.now() + 60000, value: "challenge", payload: JSON.stringify({ intents: [] }) } }, requests: [] };
  const store: StateStore = { read: fn => fn(state), transaction: fn => fn(state) };
  const context = { route: "confidential/unlock", body: {}, store, account, session, ceremony: "ceremony", url: new URL("https://id.example/api/near/confidential/unlock") } as unknown as AccountWorkflowContext;
  return { context, state };
}
it("keeps provider credentials out of responses and rejects signature replay", async () => {
  const { context } = setup();
  expect((await runConfidential(context))?.body).toEqual({ unlocked: true });
  await expect(runConfidential(context)).rejects.toThrow(/Challenge/);
  expect(mocks.authenticate).toHaveBeenCalledTimes(1);
  expect((await runConfidential({ ...context, route: "confidential/balances" }))?.body).toEqual({ balances: [] });
  expect(mocks.balances).toHaveBeenCalledWith("secret-access");
});
it("returns balances with a dashboard unlock, and still reports the unlock when the balance read fails", async () => {
  const dashboard = new URL("https://id.example/api/near/confidential/unlock?balances=all");
  mocks.balances.mockResolvedValueOnce({ balances: [{ tokenId: "token", available: "1500000", source: "private" }] });
  const unlocked = await runConfidential({ ...setup().context, url: dashboard });
  expect(unlocked?.body).toMatchObject({ unlocked: true, balances: { accountId: "identity", assets: [{ assetId: "token", raw: "1500000", amount: "1.5" }] } });
  expect(JSON.stringify(unlocked?.body)).not.toContain("secret");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.balances.mockRejectedValueOnce(new Error("private endpoint unavailable"));
  expect((await runConfidential({ ...setup().context, url: dashboard }))?.body).toEqual({ unlocked: true });
  expect(warn).toHaveBeenCalledTimes(1);
});
it("rejects cross-account and expired ceremonies before provider authentication", async () => {
  for (const expired of [false, true]) {
    const { context, state } = setup();
    if (expired) state.challenges[hash("ceremony")].expires = 0;
    else state.challenges[hash("ceremony")].accountId = "another-user";
    await expect(runConfidential(context)).rejects.toThrow();
  }
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.authenticate).not.toHaveBeenCalled();
});
it("does not unlock a session revoked while authentication is in flight", async () => {
  const { context, state } = setup();
  mocks.authenticate.mockImplementationOnce(async () => {
    delete state.sessions[hash(context.session!)];
    return { accessToken: "access", refreshToken: "refresh", expiresIn: 600, refreshExpiresIn: 3600 };
  });
  await expect(runConfidential(context)).rejects.toThrow("Session expired");
  await expect(runConfidential({ ...context, route: "confidential/balances" })).rejects.toThrow("Unlock");
});
it("isolates private credentials by app session and clears them after failed refresh", async () => {
  const { context } = setup();
  mocks.authenticate.mockResolvedValueOnce({ accessToken: "access", refreshToken: "refresh", expiresIn: 1, refreshExpiresIn: 3600 });
  await runConfidential(context);
  await expect(runConfidential({ ...context, route: "confidential/balances", session: randomUUID() })).rejects.toThrow("Unlock");
  mocks.refresh.mockRejectedValueOnce(new ConfidentialAccessRequired("Confidential session expired. Unlock again."));
  await expect(runConfidential({ ...context, route: "confidential/balances" })).rejects.toThrow("Unlock again");
  await expect(runConfidential({ ...context, route: "confidential/balances" })).rejects.toThrow("Unlock confidential");
  expect(mocks.balances).not.toHaveBeenCalled();
});
it("maps only authenticated private balances into the trading catalog without losing precision", async () => {
  const { privateLiveBalances } = await import("../../../backend/id/src/near/services/confidential-workflow");
  const { context } = setup();
  await runConfidential(context);
  mocks.balances.mockResolvedValueOnce({ balances: [{ tokenId: "token", available: "123456789012345678901", source: "private" }] });
  const result = await privateLiveBalances(context.store, context.session, "user", "identity", [{ assetId: "token", symbol: "TOKEN", decimals: 6 }, { assetId: "missing", symbol: "ZERO", decimals: 6 }]);
  expect(result.assets[0]).toMatchObject({ raw: "123456789012345678901", amount: "123456789012345.678901" });
  expect(result.assets[1].raw).toBe("0");
  mocks.balances.mockRejectedValueOnce(new Error("private endpoint unavailable"));
  await expect(privateLiveBalances(context.store, context.session, "user", "identity")).rejects.toThrow("private endpoint unavailable");
});
it("retains refresh credentials after a temporary provider outage", async () => {
  const { context } = setup();
  mocks.authenticate.mockResolvedValueOnce({ accessToken: "access", refreshToken: "refresh", expiresIn: 1, refreshExpiresIn: 3600 });
  await runConfidential(context);
  mocks.refresh.mockRejectedValueOnce(new Error("temporarily unavailable"));
  await expect(runConfidential({ ...context, route: "confidential/balances" })).rejects.toThrow("temporarily unavailable");
  mocks.refresh.mockResolvedValueOnce({ accessToken: "renewed", expiresIn: 600 });
  await expect(runConfidential({ ...context, route: "confidential/balances" })).resolves.toMatchObject({ body: { balances: [] } });
  expect(mocks.balances).toHaveBeenCalledWith("renewed");
});
