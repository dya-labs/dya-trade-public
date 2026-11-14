// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../../../backend/id/src/near/repositories/sqlite-store";
import { hash, type SnapshotReader } from "../../../backend/id/src/near/repositories/store";
import { rememberConfidentialSession, confidentialSessionBalances, transferConfidentialSession } from "../../../backend/id/src/near/services/confidential-sessions";
const provider = vi.hoisted(() => ({ refresh: vi.fn(), balances: vi.fn() }));
vi.mock("../../../backend/id/src/near/providers/confidential", () => ({ refreshConfidential: provider.refresh, readConfidentialBalances: provider.balances }));
let directory: string;
let stores: Store[];
const session = "opaque-cookie", account = "account";
const auth = { accessToken: "private-access", refreshToken: "private-refresh", expiresIn: 600, refreshExpiresIn: 3600 };
function connection() { const store = new Store(join(directory, "test.sqlite")); stores.push(store); return store; }
beforeEach(() => {
  vi.stubEnv("CONFIDENTIAL_SESSION_KEY", "22".repeat(32));
  vi.resetAllMocks();
  provider.balances.mockResolvedValue({ balances: [] });
  directory = mkdtempSync(join(tmpdir(), "private-session-test-")); stores = [];
  connection().transaction(s => {
    s.accounts[account] = { id: account, kind: "passkey" };
    s.sessions[hash(session)] = { accountId: account, expires: Date.now() + 3600000 };
  });
});
afterEach(() => { stores.forEach(s => s.close()); rmSync(directory, { recursive: true }); vi.unstubAllEnvs(); });
it("restores encrypted tokens through a separate database connection", async () => {
  await rememberConfidentialSession(stores[0], session, account, auth);
  const serialized = stores[0].read(s => JSON.stringify(s));
  expect(serialized).not.toContain(auth.accessToken);
  expect(serialized).not.toContain(auth.refreshToken);
  await confidentialSessionBalances(connection(), session, account);
  expect(provider.balances).toHaveBeenCalledWith(auth.accessToken);
});
it("coordinates concurrent refresh across independent connections", async () => {
  await rememberConfidentialSession(stores[0], session, account, { ...auth, expiresIn: 1 });
  provider.refresh.mockImplementation(async () => {
    await new Promise(resolve => setTimeout(resolve, 40));
    return { accessToken: "renewed", expiresIn: 600 };
  });
  await Promise.all([confidentialSessionBalances(stores[0], session, account), confidentialSessionBalances(connection(), session, account)]);
  expect(provider.refresh).toHaveBeenCalledTimes(1);
  expect(provider.balances).toHaveBeenCalledTimes(2);
  expect(provider.balances).toHaveBeenCalledWith("renewed");
});
it("does not resurrect a session logged out during refresh", async () => {
  await rememberConfidentialSession(stores[0], session, account, { ...auth, expiresIn: 1 });
  provider.refresh.mockImplementation(async () => {
    connection().transaction(s => { delete s.sessions[hash(session)]; });
    return { accessToken: "renewed", expiresIn: 600 };
  });
  await expect(confidentialSessionBalances(stores[0], session, account)).rejects.toThrow("session changed");
  expect(provider.balances).not.toHaveBeenCalled();
  expect(stores[0].read(s => s.sessions[hash(session)])).toBeUndefined();
});
it("rejects token tampering and requires renewed proof after key rotation", async () => {
  await rememberConfidentialSession(stores[0], session, account, auth);
  vi.stubEnv("CONFIDENTIAL_SESSION_KEY", "33".repeat(32));
  await expect(confidentialSessionBalances(connection(), session, account)).rejects.toThrow("could not be restored");
  expect(provider.balances).not.toHaveBeenCalled();
});
it("fails closed without an encryption key and does not save plaintext", async () => {
  vi.stubEnv("CONFIDENTIAL_SESSION_KEY", "");
  await expect(rememberConfidentialSession(stores[0], session, account, auth)).rejects.toThrow("not configured");
  expect(stores[0].read(s => s.sessions[hash(session)].confidential)).toBeUndefined();
});
it("expires private access and recovers an abandoned refresh lease", async () => {
  await rememberConfidentialSession(stores[0], session, account, { ...auth, expiresIn: 1 });
  stores[0].transaction(s => { s.sessions[hash(session)].confidential!.lease = { owner: "crashed-worker", until: Date.now() - 1 }; });
  provider.refresh.mockResolvedValue({ accessToken: "renewed", expiresIn: 600 });
  await confidentialSessionBalances(connection(), session, account);
  stores[0].transaction(s => { s.sessions[hash(session)].confidential!.refreshExpires = 0; });
  await expect(confidentialSessionBalances(connection(), session, account)).rejects.toThrow("Unlock");
});

it("moves private tokens to a separately bound app grant without sharing refresh leases", async () => {
  const store = stores[0], target = "app-grant";
  await rememberConfidentialSession(store, session, account, auth);
  const original = store.read(s => s.sessions[hash(session)].confidential!.ciphertext);
  store.transaction(s => {
    s.sessions[hash(target)] = { accountId: account, expires: Date.now() + 3600000 };
    transferConfidentialSession(s, session, target);
  });
  expect(store.read(s => s.sessions[hash(session)].confidential)).toBeUndefined();
  expect(store.read(s => s.sessions[hash(target)].confidential!.ciphertext)).not.toBe(original);
  await confidentialSessionBalances(store, target, account);
  expect(provider.balances).toHaveBeenCalledWith(auth.accessToken);
  await expect(confidentialSessionBalances(store, session, account)).rejects.toThrow("Unlock");
});

it("reads valid private access without a write transaction and rejects revocation during the provider call", async () => {
  const store = stores[0];
  await rememberConfidentialSession(store, session, account, auth);
  const writes = vi.spyOn(store, "transaction");
  await confidentialSessionBalances(store, session, account);
  expect(writes).not.toHaveBeenCalled();
  provider.balances.mockImplementationOnce(async () => {
    connection().transaction(s => { delete s.sessions[hash(session)]; });
    return { balances: [] };
  });
  await expect(confidentialSessionBalances(store, session, account)).rejects.toThrow("restore private balance access");
});
it("rejects a token from a snapshot the request holds once the session is gone", async () => {
  const store = stores[0];
  await rememberConfidentialSession(store, session, account, auth);
  const before = store.read(s => structuredClone(s)), held: SnapshotReader = { read: fn => fn(before) };
  await confidentialSessionBalances(store, session, account, held);
  expect(provider.balances).toHaveBeenCalledWith(auth.accessToken);
  connection().transaction(s => { delete s.sessions[hash(session)]; });
  await expect(confidentialSessionBalances(store, session, account, held)).rejects.toThrow("restore private balance access");
});
it("refreshes a token that the held snapshot shows about to expire", async () => {
  const store = stores[0];
  await rememberConfidentialSession(store, session, account, { ...auth, expiresIn: 1 });
  const before = store.read(s => structuredClone(s)), held: SnapshotReader = { read: fn => fn(before) };
  provider.refresh.mockResolvedValue({ accessToken: "renewed", expiresIn: 600 });
  await confidentialSessionBalances(store, session, account, held);
  expect(provider.refresh).toHaveBeenCalledTimes(1);
  expect(provider.balances).toHaveBeenCalledWith("renewed");
});
