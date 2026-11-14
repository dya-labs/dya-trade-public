import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { hash, consumeChallenge } from "../src/near/repositories/store";
import { harness, origin, synchronized } from "./d1-harness";
import { handleService, completeConnection, completeApproval } from "../src/bridge/service";
import { handleNear } from "../src/near/http/api";
import { rememberConfidentialSession, withConfidentialSession } from "../src/near/services/confidential-sessions";
import { ConfidentialRefreshBusyError } from "../src/near/repositories/storage-error";
import type { D1Client } from "../src/near/repositories/d1-records";
const provider = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("../src/near/providers/confidential", () => ({ refreshConfidential: provider.refresh }));
vi.mock("../src/near/http/api", () => ({ handleNear: vi.fn(async () => NextResponse.json({ submitted: true })) }));
let h: Awaited<ReturnType<typeof harness>>;
const verifier = "v".repeat(43), verifierHash = createHash("sha256").update(verifier).digest("base64url");
const session = "host-session";
const store = (db: D1Client = h.db) => new D1Store(db, origin, new StatementBudget("paid"));
beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(handleNear).mockResolvedValue(NextResponse.json({ submitted: true }));
  vi.stubEnv("APP_ORIGIN", origin); vi.stubEnv("DYA_TERMINAL_ORIGIN", "http://localhost:3100"); vi.stubEnv("DYA_SERVICE_SECRET", "synthetic-service-secret"); vi.stubEnv("CONFIDENTIAL_SESSION_KEY", "22".repeat(32));
  h = await harness();
  await store().transaction(s => {
    // No public key: session snapshots would derive an Intents identity from it.
    s.accounts.alice = { id: "alice", kind: "passkey", credentialId: "credential", counter: 0 };
    s.sessions[hash(session)] = { accountId: "alice", expires: Date.now() + 3600000 };
  });
});
afterEach(async () => { await h?.mf.dispose(); vi.unstubAllEnvs(); });
function service(body: unknown, db = h.db) {
  return handleService(new NextRequest(`${origin}/api/service`, { method: "POST", headers: { "x-dya-service-secret": "synthetic-service-secret", "content-type": "application/json" }, body: JSON.stringify(body) }), store(db));
}
async function connection() {
  const flow = await (await service({ operation: "flow", body: { action: "connect", verifierHash } })).json();
  const result = await completeConnection(flow.flowId, session, store());
  return { flow, result };
}
test("same_challenge_has_one_winner", async () => {
  await store().transaction(s => { s.challenges[hash("challenge")] = { purpose: "login", value: "proof", expires: Date.now() + 60000 }; });
  const db = synchronized(h.db);
  const result = await Promise.allSettled([consumeChallenge(store(db), "challenge", "login"), consumeChallenge(store(db), "challenge", "login")]);
  expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(await store().read(s => s.challenges[hash("challenge")])).toBeUndefined();
});
test("connection_completion_and_exchange_are_single_use", async () => {
  const flow = await (await service({ operation: "flow", body: { action: "connect", verifierHash } })).json();
  let db = synchronized(h.db);
  const completed = await Promise.allSettled([completeConnection(flow.flowId, session, store(db)), completeConnection(flow.flowId, session, store(db))]);
  expect(completed.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const result = completed.find(r => r.status === "fulfilled")!;
  if (result.status !== "fulfilled") throw new Error("missing result");
  db = synchronized(h.db);
  const body = { operation: "exchange", flowId: flow.flowId, code: result.value.code, verifier };
  const responses = await Promise.all([service(body, db), service(body, db)]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
});
test("approval_claim_publishes_once_and_receipt_is_bound", async () => {
  const { flow, result } = await connection();
  const exchanged = await (await service({ operation: "exchange", flowId: flow.flowId, code: result.code, verifier })).json();
  await store().transaction(s => {
    s.sessions[hash(exchanged.session)].ceremony = "ceremony";
    s.challenges[hash("ceremony")] = { purpose: "confidential-auth", value: "proof", accountId: "alice", expires: Date.now() + 60000 };
  });
  const approval = await (await service({ operation: "flow", session: exchanged.session, body: { action: "approval", verifierHash, challenge: "proof" } })).json();
  const db = synchronized(h.db);
  const results = await Promise.allSettled([completeApproval(approval.flowId, {}, store(db)), completeApproval(approval.flowId, {}, store(db))]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(handleNear).toHaveBeenCalledTimes(1); // Mocked publication only.
  expect((await service({ operation: "receipt", session: exchanged.session, flowId: approval.flowId, path: "transfers/submit" })).status).toBe(400);
  expect((await service({ operation: "receipt", session: exchanged.session, flowId: approval.flowId, path: "confidential/unlock" })).status).toBe(200);
  await service({ operation: "request", path: "connection/revoke", session: exchanged.session });
  expect((await service({ operation: "receipt", session: exchanged.session, flowId: approval.flowId, path: "confidential/unlock" })).status).toBe(400);
});
test("simultaneous_counter_update_has_one_winner", async () => {
  const db = synchronized(h.db);
  const results = await Promise.allSettled([1, 2].map(counter => store(db).transaction(s => {
    if (s.accounts.alice.counter !== 0) throw new Error("Concurrent authentication");
    s.accounts.alice.counter = counter;
  })));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
});
test("held_refresh_lease_returns_busy_without_polling", async () => {
  await rememberConfidentialSession(store(), session, "alice", { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresIn: 1, refreshExpiresIn: 3600 });
  const lease = { owner: "another-worker", until: Date.now() + 60000 };
  await store().transaction(s => { s.sessions[hash(session)].confidential!.lease = lease; });
  const s = store(), request = vi.fn();
  const started = Date.now();
  await expect(withConfidentialSession(s, session, "alice", request)).rejects.toBeInstanceOf(ConfidentialRefreshBusyError);
  expect(Date.now() - started).toBeLessThan(1000);
  expect((s.context as StatementBudget).statements).toBe(1);
  expect(provider.refresh).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  expect(await store().read(s => s.sessions[hash(session)].confidential!.lease)).toEqual(lease);
});
test("contention_discovered_in_claim_returns_busy", async () => {
  await rememberConfidentialSession(store(), session, "alice", { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresIn: 1, refreshExpiresIn: 3600 });
  let reads = 0;
  const db: D1Client = { prepare: h.db.prepare.bind(h.db), async batch<T>(statements: D1PreparedStatement[]) {
    const result = await h.db.batch<T>(statements);
    if (statements.length === 1 && ++reads === 1) await store().transaction(s => { s.sessions[hash(session)].confidential!.lease = { owner: "winner", until: Date.now() + 60000 }; });
    return result;
  } };
  await expect(withConfidentialSession(store(db), session, "alice", vi.fn())).rejects.toBeInstanceOf(ConfidentialRefreshBusyError);
  expect(provider.refresh).not.toHaveBeenCalled();
  expect(await store().read(s => s.sessions[hash(session)].confidential!.lease?.owner)).toBe("winner");
});
test("revocation_and_refresh_version_are_authoritative", async () => {
  await rememberConfidentialSession(store(), session, "alice", { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresIn: 1, refreshExpiresIn: 3600 });
  provider.refresh.mockImplementation(async () => { await store().transaction(s => { delete s.sessions[hash(session)]; }); return { accessToken: "renewed", expiresIn: 600 }; });
  const request = vi.fn();
  await expect(withConfidentialSession(store(), session, "alice", request)).rejects.toThrow("session changed");
  expect(request).not.toHaveBeenCalled(); expect(await store().read(s => s.sessions[hash(session)])).toBeUndefined();
});
test("operation_unknown_state_survives_new_adapter", async () => {
  await store().transaction(s => { s.liveTrades = { uncertain: { id: "uncertain", ownerId: "alice", createdAt: 1, updatedAt: 2, state: "unknown", review: {} as never, intentHash: "synthetic-hash" } }; });
  expect(await store().read(s => s.liveTrades!.uncertain)).toMatchObject({ state: "unknown", intentHash: "synthetic-hash" });
});
