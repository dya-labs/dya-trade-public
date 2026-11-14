import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authenticator } from "./fixtures/authenticator";
import { harness, origin } from "./d1-harness";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { handleNear } from "../src/near/http/api";
import { hash } from "../src/near/repositories/store";
import { addressFromPublicKey, hashPersonalMessage } from "../src/near/auth/recovery-wallet";
import { newSession } from "../src/near/services/workflow-context";
import { completeConnection, handleService } from "../src/bridge/service";

const KEY = Buffer.from("11".repeat(32), "hex");
const OTHER = Buffer.from("22".repeat(32), "hex");
const address = addressFromPublicKey(secp256k1.getPublicKey(KEY, false));
function sign(message: string, key = KEY) {
  const result = secp256k1.sign(hashPersonalMessage(message), key, { prehash: false, format: "recovered" });
  return `0x${Buffer.from(result.slice(1)).toString("hex")}${(27 + result[0]).toString(16)}`;
}
let h: Awaited<ReturnType<typeof harness>>;
const store = () => new D1Store(h.db, origin, new StatementBudget("paid"));
beforeEach(async () => {
  vi.stubEnv("APP_ORIGIN", origin); vi.stubEnv("DYA_ID_LOCAL_RECOVERY", "1"); vi.stubEnv("DYA_ID_D1_QUERY_PROFILE", "paid");
  vi.stubEnv("DYA_SERVICE_SECRET", "synthetic-service-secret-at-least-32-characters"); vi.stubEnv("DYA_TERMINAL_ORIGIN", "http://localhost:3100");
  h = await harness();
});
afterEach(async () => { await h?.mf.dispose(); vi.unstubAllEnvs(); });
function browser(initial: Record<string, string> = {}) {
  const jar = { ...initial };
  return { jar, async call(path: string, body?: unknown, requestOrigin = origin) {
    const request = new NextRequest(`${origin}/api/near/${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin: requestOrigin, "content-type": "application/json", cookie: Object.entries(jar).map(([k,v]) => `${k}=${v}`).join("; ") }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const simulator = vi.fn(() => { throw new Error("Live simulator must not be called"); });
    const balances = vi.fn(() => { throw new Error("Live balances must not be called"); });
    const res = await handleNear(request, path.split("/"), store(), simulator, balances);
    for (const c of res.cookies.getAll()) { if (c.value) jar[c.name] = c.value; else delete jar[c.name]; }
    expect(simulator).not.toHaveBeenCalled(); expect(balances).not.toHaveBeenCalled();
    return { status: res.status, data: await res.json() };
  } };
}
async function setup() {
  const b = browser(), primary = authenticator(origin);
  const options = await b.call("auth/register/options", {});
  expect((await b.call("auth/register/verify", primary.registration(options.data.challenge))).status).toBe(200);
  const snapshot = (await b.call("state")).data;
  return { b, primary, id: snapshot.account.id as string, identity: snapshot.account.intentsIdentity };
}
async function enroll(b: ReturnType<typeof browser>, primary: ReturnType<typeof authenticator>, counter = 1) {
  const options = await b.call("recovery/authorize/options", { address, chainId: 1 });
  expect(options.status).toBe(200);
  const approved = await b.call("recovery/authorize/verify", primary.assertion(options.data.challenge, counter));
  expect(approved.status).toBe(200);
  return { approved, result: await b.call("recovery/enroll", { signature: sign(approved.data.message) }) };
}
async function replacement(b: ReturnType<typeof browser>, id: string) {
  const key = authenticator(origin);
  const options = await b.call("recovery/register/options", { recoveryId: id, address, chainId: 1 });
  expect(options.status).toBe(200);
  const proof = await b.call("recovery/register/verify", key.registration(options.data.challenge));
  expect(proof.status).toBe(200);
  return { key, proof };
}

test("real_signatures_restore_original_identity_revoke_sessions_grants_approvals_and_old_passkey", async () => {
  const { b, primary, id, identity } = await setup();
  expect((await enroll(b, primary)).result.status).toBe(200);
  const old = browser(b.jar);
  await store().transaction(s => {
    s.sessions[hash("app-grant")] = { accountId: id, expires: Date.now() + 60000, clientOrigin: "http://localhost:3100" };
    s.challenges.approval = { accountId: id, purpose: "intents", value: "pending", expires: Date.now() + 60000 };
    s.accounts[id].backup = { id: "backup", publicKey: s.accounts[id].publicKey!, counter: 0, status: "pending_onchain" };
  });
  const recovery = browser();
  const { key, proof } = await replacement(recovery, id);
  expect((await recovery.call("recovery/complete", { signature: sign(proof.data.message) })).status).toBe(200);
  const snapshot = (await recovery.call("state")).data;
  expect(snapshot.account.id).toBe(id); expect(snapshot.account.intentsIdentity).toEqual(identity);
  expect((await old.call("state")).data.account).toBeNull();
  expect(await store().read(s => !!s.sessions[hash("app-grant")])).toBe(false);
  expect(await store().read(s => s.challenges.approval)).toBeUndefined();
  expect(await store().read(s => s.accounts[id].backup)).toBeUndefined();
  const login = browser();
  const options = await login.call("auth/login/options", {});
  expect((await login.call("auth/login/verify", primary.assertion(options.data.challenge, 2))).status).toBe(400);
  const fresh = await login.call("auth/login/options", { credentialId: key.id });
  expect((await login.call("auth/login/verify", key.assertion(fresh.data.challenge, 1))).status).toBe(200);
  expect((await login.call("state")).data.account.id).toBe(id);
  await expect(newSession(store(), id, undefined, primary.id)).rejects.toThrow("Passkey changed");
});

test("primary_approval_wallet_ownership_origin_and_single_use_are_enforced", async () => {
  const { b, primary } = await setup();
  expect((await b.call("recovery/enroll", { signature: sign("not approved") })).status).toBe(400);
  const options = await b.call("recovery/authorize/options", { address, chainId: 1 });
  expect((await b.call("recovery/authorize/verify", authenticator(origin).assertion(options.data.challenge, 1))).status).toBe(400);
  const next = await b.call("recovery/authorize/options", { address, chainId: 1 });
  const approved = await b.call("recovery/authorize/verify", primary.assertion(next.data.challenge, 1));
  const replay = browser(b.jar);
  expect((await b.call("recovery/enroll", { signature: sign(approved.data.message, OTHER) })).status).toBe(400);
  expect((await replay.call("recovery/enroll", { signature: sign(approved.data.message) })).status).toBe(400);
  expect((await b.call("recovery/authorize/options", { address, chainId: 1 }, "https://evil.example")).status).toBe(403);
});

test("interrupted_expired_and_tampered_recovery_leave_primary_unchanged", async () => {
  const { b, primary, id } = await setup(); await enroll(b, primary);
  const r = browser(); const first = await replacement(r, id);
  expect(await store().read(s => s.accounts[id].credentialId)).toBe(primary.id);
  expect((await r.call("recovery/complete", { signature: sign(first.proof.data.message + "tampered") })).status).toBe(400);
  const second = await replacement(r, id);
  await store().transaction(s => { s.challenges[hash(r.jar.near_challenge)].expires = 0; });
  expect((await r.call("recovery/complete", { signature: sign(second.proof.data.message) })).status).toBe(400);
  expect(await store().read(s => s.accounts[id].credentialId)).toBe(primary.id);
});

test("concurrent_rotations_and_replayed_signatures_commit_once", async () => {
  const { b, primary, id } = await setup(); await enroll(b, primary);
  const a = browser(), c = browser();
  const first = await replacement(a, id), second = await replacement(c, id);
  const results = await Promise.all([a.call("recovery/complete", { signature: sign(first.proof.data.message) }), c.call("recovery/complete", { signature: sign(second.proof.data.message) })]);
  expect(results.map(r => r.status).sort()).toEqual([200, 400]);
  const winner = results[0].status === 200 ? a : c;
  expect((await winner.call("recovery/complete", { signature: sign(first.proof.data.message) })).status).toBe(400);
  expect(await store().read(s => Object.keys(s.sessions).length)).toBe(1);
});

test("local_test_accounts_fail_closed_for_all_live_routes_and_hosted_recovery", async () => {
  const { b } = await setup();
  for (const route of ["live/balances", "confidential/balances", "transfers/deposit", "live/market/prepare", "intents/options"]) {
    expect((await b.call(route, route === "live/balances" ? undefined : {})).status).toBe(403);
  }
  vi.stubEnv("APP_ORIGIN", "https://id.example"); vi.stubEnv("INTERNAL_ACCESS_PASSWORD", "test");
  const res = await handleNear(new NextRequest("https://id.example/api/near/recovery/register/options", { method: "POST", headers: { origin: "https://id.example", "content-type": "application/json", authorization: `Basic ${Buffer.from("tester:test").toString("base64")}` }, body: "{}" }), ["recovery", "register", "options"], store());
  expect(res.status).toBe(400); expect(await res.json()).toMatchObject({ code: "RECOVERY_UNAVAILABLE", error: "Wallet recovery is unavailable." });
});

test("enrollment_and_replacement_survive_actual_workerd_restart", async () => {
  await h.mf.dispose();
  const path = await mkdtemp(join(tmpdir(), "dya-recovery-")); const persistence = { path, id: crypto.randomUUID() };
  try {
    h = await harness(true, persistence);
    const { b, primary, id, identity } = await setup(); await enroll(b, primary);
    await h.mf.dispose(); h = await harness(false, persistence, false);
    expect((await b.call("state")).data.account.recoveryWallet.address).toBe(address);
    const r = browser(); const next = await replacement(r, id);
    expect((await r.call("recovery/complete", { signature: sign(next.proof.data.message) })).status).toBe(200);
    await h.mf.dispose(); h = await harness(false, persistence, false);
    expect((await r.call("state")).data.account.intentsIdentity).toEqual(identity);
    expect((await b.call("state")).data.account).toBeNull();
  } finally { await h.mf.dispose(); await rm(path, { recursive: true, force: true }); h = await harness(); }
});

test("hosted_connection_receipts_and_grants_are_invalidated_on_rotation", async () => {
  const { b, primary, id } = await setup(); await enroll(b, primary);
  const request = (body: unknown) => new NextRequest(`${origin}/api/service`, { method: "POST", headers: { "x-dya-service-secret": "synthetic-service-secret-at-least-32-characters", "content-type": "application/json" }, body: JSON.stringify(body) });
  const verifier = "v".repeat(43);
  const flowResponse = await handleService(request({ operation: "flow", body: { action: "connect", verifierHash: verifier } }), store());
  expect(flowResponse.status).toBe(200);
  const { flowId } = await flowResponse.json();
  await completeConnection(flowId, b.jar.near_session, store());
  const r = browser(); const next = await replacement(r, id);
  expect((await r.call("recovery/complete", { signature: sign(next.proof.data.message) })).status).toBe(200);
  expect(await store().read(s => s.challenges[hash(flowId)])).toBeUndefined();
});

test("existing_accounts_and_disabled_mode_cannot_enroll_or_rotate", async () => {
  const { b, primary, id } = await setup();
  await store().transaction(s => { delete s.accounts[id].localRecovery; });
  expect((await b.call("recovery/authorize/options", { address, chainId: 1 })).status).toBe(400);
  expect(await store().read(s => s.accounts[id].credentialId)).toBe(primary.id);
  vi.stubEnv("DYA_ID_LOCAL_RECOVERY", "0");
  expect((await browser().call("recovery/register/options", { recoveryId: id, address, chainId: 1 })).status).toBe(400);
});

test("enrollment_cookie_cannot_authorize_another_account_and_registered_keys_cannot_replace", async () => {
  const { b, primary, id } = await setup();
  const { b: other } = await setup();
  const opts = await b.call("recovery/authorize/options", { address, chainId: 1 });
  const approved = await b.call("recovery/authorize/verify", primary.assertion(opts.data.challenge, 1));
  const stolen = browser({ near_session: other.jar.near_session, near_challenge: b.jar.near_challenge });
  expect((await stolen.call("recovery/enroll", { signature: sign(approved.data.message) })).status).toBe(400);
  expect(await store().read(s => s.accounts[id].recoveryWallet)).toBeUndefined();
  await enroll(b, primary, 2);
  const r = browser();
  const options = await r.call("recovery/register/options", { recoveryId: id, address, chainId: 1 });
  const proof = await r.call("recovery/register/verify", primary.registration(options.data.challenge));
  expect(proof.status).toBe(200);
  expect((await r.call("recovery/complete", { signature: sign(proof.data.message) })).status).toBe(400);
  expect(await store().read(s => s.accounts[id].credentialId)).toBe(primary.id);
});
