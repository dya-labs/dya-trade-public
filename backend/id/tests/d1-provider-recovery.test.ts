import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { authenticator } from "./fixtures/authenticator";
import { recoveryProviderTransport } from "./fixtures/recovery-provider";
import { harness, origin } from "./d1-harness";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { handleNear } from "../src/near/http/api";
import { hash } from "../src/near/repositories/store";
import { addressFromPublicKey, hashPersonalMessage } from "../src/near/auth/recovery-wallet";
import { confidentialSessionBalances } from "../src/near/services/confidential-sessions";
import { accountIdentity, intentsIdentity } from "../src/near/auth/intents";
import { newSession } from "../src/near/services/workflow-context";
let h: Awaited<ReturnType<typeof harness>>;
let provider: ReturnType<typeof recoveryProviderTransport>;
const KEY = Buffer.from("11".repeat(32), "hex"), WRONG = Buffer.from("22".repeat(32), "hex");
const address = addressFromPublicKey(secp256k1.getPublicKey(KEY, false));
function sign(message: string, key = KEY) { const s = secp256k1.sign(hashPersonalMessage(message), key, { prehash: false, format: "recovered" }); return `0x${Buffer.from(s.slice(1)).toString("hex")}${(27 + s[0]).toString(16)}`; }
const store = () => new D1Store(h.db, origin, new StatementBudget("paid"));
beforeEach(async () => {
  h = await harness(); provider = recoveryProviderTransport(); vi.stubGlobal("fetch", provider.fetcher);
  vi.stubEnv("APP_ORIGIN", origin); vi.stubEnv("DYA_ID_LOCAL_RECOVERY", "0"); vi.stubEnv("DYA_ID_PROVIDER_RECOVERY", "1");
  vi.stubEnv("ONE_CLICK_JWT", "synthetic-partner-credential"); vi.stubEnv("CONFIDENTIAL_SESSION_KEY", "55".repeat(32));
});
afterEach(async () => { await h?.mf.dispose(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function browser(initial: Record<string, string> = {}) {
  const jar = { ...initial };
  return { jar, async call(path: string, body?: unknown) {
    const r = await handleNear(new NextRequest(`${origin}/api/near/${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin, "content-type": "application/json", cookie: Object.entries(jar).map(([k,v]) => `${k}=${v}`).join("; ") }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), path.split("/"), store());
    const data = await r.json(); for (const c of r.cookies.getAll()) { if (c.value) jar[c.name] = c.value; else delete jar[c.name]; }
    return { status: r.status, data };
  } };
}
const call = (b: ReturnType<typeof browser>, path: string, body: unknown = {}) => b.call(`recovery/provider/${path}`, body);
async function setup() {
  const b = browser(), primary = authenticator(origin);
  const opts = await b.call("auth/register/options", {});
  expect((await b.call("auth/register/verify", primary.registration(opts.data.challenge))).status).toBe(200);
  const a = (await b.call("state")).data.account;
  provider.balances.set(a.intentsIdentity.accountId, [{ tokenId: "nep141:usdc", available: "1234567", source: "private" }]);
  return { b, primary, id: a.id as string, identity: a.intentsIdentity };
}
async function enroll(b: ReturnType<typeof browser>, primary: ReturnType<typeof authenticator>) {
  let r = await call(b, "enroll/options", { address, chainId: 1 }); expect(r.status).toBe(200);
  r = await call(b, "enroll/proof", { signature: sign(r.data.message) }); expect(r.status).toBe(200); expect(r.data.phase).toBe("enroll_key");
  r = await call(b, "enroll/submit", primary.assertion(r.data.options.challenge, 1)); expect(r.status).toBe(200); expect(r.data.phase).toBe("enroll_pending");
  r = await call(b, "status"); expect(r.data.phase).toBe("enroll_auth");
  r = await call(b, "enroll/verify", { signature: sign(r.data.message) }); expect(r.status).toBe(200); expect(r.data.phase).toBe("complete");
}
async function startRecovery(id: string) {
  const b = browser(), key = authenticator(origin);
  let r = await call(b, "recover/options", { address, chainId: 1, recoveryId: id }); expect(r.status).toBe(200);
  r = await call(b, "recover/register", key.registration(r.data.options.challenge)); expect(r.status).toBe(200); expect(r.data.phase).toBe("recover_add");
  return { b, key, add: r.data };
}
async function finishRecovery(b: ReturnType<typeof browser>, key: ReturnType<typeof authenticator>) {
  let r = await call(b, "status"); expect(r.data.phase).toBe("recover_test");
  r = await call(b, "recover/test", key.assertion(r.data.options.challenge, 1)); expect(r.status).toBe(200); expect(r.data.phase).toBe("recover_remove");
  r = await call(b, "recover/remove", { signature: sign(r.data.message) }); expect(r.status).toBe(200);
  r = await call(b, "status"); expect(r.data.phase).toBe("recover_finish");
  r = await call(b, "recover/finish", key.assertion(r.data.options.challenge, 2)); expect(r.status).toBe(200); expect(r.data.phase).toBe("complete");
}

test("real_proofs_mock_provider_preserves_funded_balance_and_confirms_remote_revocation_before_local_commit", async () => {
  const { b, primary, id, identity } = await setup(); await enroll(b, primary);
  const oldSession = b.jar.near_session;
  await store().transaction(s => { s.sessions[hash("grant")] = { accountId: id, expires: Date.now() + 60000, clientOrigin: "http://localhost:3100" }; s.challenges.old = { purpose: "intents", value: "pending", accountId: id, expires: Date.now() + 60000 }; });
  const recovery = await startRecovery(id);
  expect((await call(recovery.b, "recover/add", { signature: sign(recovery.add.message) })).status).toBe(200);
  expect(await store().read(s => s.sessions[hash(oldSession)])).toBeUndefined(); expect(await store().read(s => s.sessions[hash("grant")])).toBeUndefined();
  expect(await store().read(s => s.accounts[id].credentialId)).toBe(primary.id);
  await finishRecovery(recovery.b, recovery.key);
  const a = await store().read(s => s.accounts[id]);
  expect(a.credentialId).toBe(recovery.key.id); expect(accountIdentity(a).accountId).toBe(identity.accountId);
  expect(provider.isKey(identity.accountId, identity.publicKey)).toBe(false);
  expect(provider.isKey(identity.accountId, intentsIdentity(a.publicKey!).publicKey)).toBe(true);
  expect((await confidentialSessionBalances(store(), recovery.b.jar.near_session, id)).balances[0].available).toBe("1234567");
  expect(provider.authSigners.every(s => s.accountId === identity.accountId)).toBe(true);
  await expect(newSession(store(), id, undefined, primary.id)).rejects.toThrow("Passkey changed");
  const oldLogin = browser(); const options = await oldLogin.call("auth/login/options", {});
  expect((await oldLogin.call("auth/login/verify", primary.assertion(options.data.challenge, 2))).status).toBe(400);
});

test("relay_acceptance_and_unconfirmed_key_views_never_report_ready", async () => {
  const { b, primary, id } = await setup(); provider.setPending(true);
  let r = await call(b, "enroll/options", { address, chainId: 1 }); r = await call(b, "enroll/proof", { signature: sign(r.data.message) });
  await call(b, "enroll/submit", primary.assertion(r.data.options.challenge, 1));
  expect((await call(b, "status")).data.phase).toBe("enroll_pending");
  expect(await store().read(s => s.accounts[id].providerRecovery?.controller)).toBeUndefined();
  provider.settleAll(); r = await call(b, "status"); expect(r.data.phase).toBe("enroll_auth");
  provider.setAuthRejected(true);
  expect((await call(b, "enroll/verify", { signature: sign(r.data.message) })).status).toBe(400);
  expect(await store().read(s => s.accounts[id].providerRecovery?.controller)).toBeUndefined();
});

test("unverified_replacement_access_never_revokes_original_provider_key", async () => {
  const { b, primary, id, identity } = await setup(); await enroll(b, primary);
  const r = await startRecovery(id); await call(r.b, "recover/add", { signature: sign(r.add.message) });
  const proof = await call(r.b, "status"); provider.setAuthRejected(true);
  expect((await call(r.b, "recover/test", r.key.assertion(proof.data.options.challenge, 1))).status).toBe(400);
  expect(provider.publications).toHaveLength(2); expect(provider.isKey(identity.accountId, identity.publicKey)).toBe(true);
  expect(await store().read(s => s.accounts[id].credentialId)).toBe(primary.id);
});

test("lost_submission_response_resumes_after_wallet_proof_without_retransmitting", async () => {
  const { b, primary, id } = await setup(); await enroll(b, primary);
  const r = await startRecovery(id); provider.setAmbiguous(true);
  const claimed = await call(r.b, "recover/add", { signature: sign(r.add.message) }); expect(claimed.data.outcome).toBe("unknown");
  provider.setAmbiguous(false);
  const resumed = browser(); let next = await call(resumed, "recover/options", { address, chainId: 1, recoveryId: id }); expect(next.data.phase).toBe("recover_resume");
  next = await call(resumed, "recover/resume", { signature: sign(next.data.message) }); expect(next.data.phase).toBe("recover_test");
  expect(provider.publications).toHaveLength(2);
  await finishRecovery(resumed, r.key); expect(provider.publications).toHaveLength(3);
});

test("unsigned_drafts_cannot_reserve_recovery_and_wrong_controller_never_publishes", async () => {
  const { b, primary, id } = await setup(); await enroll(b, primary);
  const attacker = await startRecovery(id); expect(await store().read(s => s.accounts[id].providerRecovery!.operation!.phase)).toBe("complete");
  const valid = await startRecovery(id);
  expect((await call(attacker.b, "recover/add", { signature: sign(attacker.add.message, WRONG) })).status).toBe(400);
  expect(provider.publications).toHaveLength(1);
  expect((await call(valid.b, "recover/add", { signature: sign(valid.add.message) })).status).toBe(200);
  expect((await call(attacker.b, "recover/add", { signature: sign(attacker.add.message) })).status).toBe(400);
  expect(provider.publications).toHaveLength(2);
});

test("phase_replay_and_old_login_cannot_bypass_in_progress_recovery", async () => {
  const { b, primary, id } = await setup(); await enroll(b, primary);
  const r = await startRecovery(id); const signed = { signature: sign(r.add.message) };
  expect((await call(r.b, "recover/add", signed)).status).toBe(200);
  expect((await call(r.b, "recover/add", signed)).status).toBe(400); expect(provider.publications).toHaveLength(2);
  const login = browser(); const options = await login.call("auth/login/options", {});
  expect((await login.call("auth/login/verify", primary.assertion(options.data.challenge, 2))).data.error).toMatch(/in progress/);
  await expect(newSession(store(), id, undefined, primary.id)).rejects.toThrow(/in progress/);
});

test("rejected_revocation_preserves_active_recovery_and_allows_fresh_review_without_new_key", async () => {
  const { b, primary, id, identity } = await setup(); await enroll(b, primary);
  const r = await startRecovery(id); await call(r.b, "recover/add", { signature: sign(r.add.message) });
  let proof = await call(r.b, "status"); proof = await call(r.b, "recover/test", r.key.assertion(proof.data.options.challenge, 1));
  provider.setRejected(true);
  const rejected = await call(r.b, "recover/remove", { signature: sign(proof.data.message) });
  expect(rejected.data.phase).toBe("recover_remove"); expect(rejected.data.error).toMatch(/Previous keys|previous keys/);
  expect(provider.isKey(identity.accountId, identity.publicKey)).toBe(true);
  expect(await store().read(s => s.accounts[id].providerRecovery!.operation!.phase)).toBe("recover_remove");
  provider.setRejected(false);
  expect((await call(r.b, "recover/remove", { signature: sign(rejected.data.message) })).status).toBe(200);
  const final = await call(r.b, "status"); expect(final.data.phase).toBe("recover_finish");
  expect((await call(r.b, "recover/finish", r.key.assertion(final.data.options.challenge, 2))).data.phase).toBe("complete");
});

test("failed_final_provider_authentication_keeps_rotation_resumable_without_false_local_success", async () => {
  const { b, primary, id } = await setup(); await enroll(b, primary);
  const r = await startRecovery(id); await call(r.b, "recover/add", { signature: sign(r.add.message) });
  let proof = await call(r.b, "status"); proof = await call(r.b, "recover/test", r.key.assertion(proof.data.options.challenge, 1));
  await call(r.b, "recover/remove", { signature: sign(proof.data.message) });
  const final = await call(r.b, "status"); provider.setAuthRejected(true);
  expect((await call(r.b, "recover/finish", r.key.assertion(final.data.options.challenge, 2))).status).toBe(400);
  expect(await store().read(s => s.accounts[id].credentialId)).toBe(primary.id);
  expect(await store().read(s => s.accounts[id].providerRecovery!.operation!.phase)).toBe("recover_finish");
  provider.setAuthRejected(false);
  expect((await call(r.b, "recover/finish", r.key.assertion(final.data.options.challenge, 3))).data.phase).toBe("complete");
});

test("unauthenticated_resume_status_does_not_bypass_wallet_ownership_proof", async () => {
  const { b, primary, id } = await setup(); await enroll(b, primary);
  const r = await startRecovery(id); await call(r.b, "recover/add", { signature: sign(r.add.message) });
  const other = browser(); const request = await call(other, "recover/options", { recoveryId: id, address, chainId: 1 });
  expect(request.data.phase).toBe("recover_resume");
  const status = await call(other, "status"); expect(status.data.phase).toBe("recover_resume"); expect(status.data.options).toBeUndefined();
  expect((await call(other, "recover/test", r.key.assertion("unbound", 1))).status).toBe(400);
});


test("provider_claims_and_encrypted_recovered_session_survive_actual_workerd_restart", async () => {
  await h.mf.dispose();
  const path = await mkdtemp(join(tmpdir(), "dya-provider-recovery-"));
  const persistence = { path, id: crypto.randomUUID() };
  try {
    h = await harness(true, persistence);
    const { b, primary, id } = await setup(); await enroll(b, primary);
    const r = await startRecovery(id); await call(r.b, "recover/add", { signature: sign(r.add.message) });
    await h.mf.dispose(); h = await harness(false, persistence, false);
    expect(await store().read(s => s.accounts[id].providerRecovery!.operation!.phase)).toBe("recover_add_pending");
    await finishRecovery(r.b, r.key);
    await h.mf.dispose(); h = await harness(false, persistence, false);
    expect((await confidentialSessionBalances(store(), r.b.jar.near_session, id)).balances[0].available).toBe("1234567");
    expect((await r.b.call("state")).data.account.id).toBe(id);
  } finally { await h.mf.dispose(); await rm(path, { recursive: true, force: true }); h = await harness(); }
});


test("wallet_discovery_requires_single_use_ownership_proof_then_recovers_without_saved_id", async () => {
  const { b, primary, id, identity } = await setup(); await enroll(b, primary);
  const recover = browser(), key = authenticator(origin);
  let r = await call(recover, "discover/options", { address, chainId: 1 });
  expect(r.status).toBe(200); expect(r.data.accounts).toBeUndefined(); expect(JSON.stringify(r.data)).not.toContain(id);
  expect((await call(recover, "discover/select", { recoveryId: id })).status).toBe(400);
  const proof = sign(r.data.message);
  expect((await call(recover, "discover/proof", { signature: sign(r.data.message, WRONG) })).status).toBe(400);
  r = await call(recover, "discover/proof", { signature: proof }); expect(r.data.accounts).toEqual([{ id, label: `DYA account ${id.slice(0, 8)}` }]);
  expect((await call(recover, "discover/proof", { signature: proof })).status).toBe(400);
  expect((await call(recover, "discover/select", { recoveryId: "unlinked" })).status).toBe(400);
  r = await call(recover, "discover/select", { recoveryId: r.data.accounts[0].id }); expect(r.data.phase).toBe("recover_register");
  expect((await call(recover, "discover/select", { recoveryId: id })).status).toBe(400);
  r = await call(recover, "recover/register", key.registration(r.data.options.challenge));
  await call(recover, "recover/add", { signature: sign(r.data.message) });
  const resumed = browser(); r = await call(resumed, "discover/options", { address, chainId: 1 });
  r = await call(resumed, "discover/proof", { signature: sign(r.data.message) });
  r = await call(resumed, "discover/select", { recoveryId: r.data.accounts[0].id }); expect(r.data.phase).toBe("recover_resume");
  r = await call(resumed, "recover/resume", { signature: sign(r.data.message) }); expect(r.data.phase).toBe("recover_test");
  await finishRecovery(resumed, key);
  expect(accountIdentity(await store().read(s => s.accounts[id])).accountId).toBe(identity.accountId);
});

test("discovery_lists_only_verified_matching_wallet_accounts_and_expires", async () => {
  const first = await setup(); await enroll(first.b, first.primary);
  const second = await setup(); await enroll(second.b, second.primary);
  await setup(); // An unenrolled account must never appear.
  const b = browser(); let r = await call(b, "discover/options", { address, chainId: 1 });
  r = await call(b, "discover/proof", { signature: sign(r.data.message) });
  expect(r.data.accounts.map((a: { id: string }) => a.id).sort()).toEqual([first.id, second.id].sort());
  await store().transaction(s => { s.challenges[hash(b.jar.near_challenge)].providerProofExpires = Date.now() - 1; });
  expect((await call(b, "discover/select", { recoveryId: first.id })).status).toBe(400);
  const other = browser(), otherAddress = addressFromPublicKey(secp256k1.getPublicKey(WRONG, false));
  r = await call(other, "discover/options", { address: otherAddress, chainId: 1 });
  r = await call(other, "discover/proof", { signature: sign(r.data.message, WRONG) }); expect(r.data.accounts).toEqual([]);
});
