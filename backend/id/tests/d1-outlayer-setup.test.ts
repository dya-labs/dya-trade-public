import { previewSetupQuote } from "../src/near/outlayer/setup-preview";
import { afterEach, expect, test, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { emptyState, hash, type StateStore } from "../src/near/repositories/store";
import { getDeploymentConfig } from "../src/deployment/config";
import { simulateProbe } from "../src/near/auth/intents";
import { readBalances } from "../src/near/providers/live";
import { outlayerSetupView, runOutlayerSetup } from "../src/near/services/outlayer-setup-workflow";
import { ownerPlan, immutableOwnerPlan } from "../src/near/outlayer/owner";
import { nextSetup, setupPresentation } from "../../../frontend/id/components/trading-setup-machine";
import { handleNear } from "../src/near/http/api";
import { NextRequest } from "next/server";
vi.mock("../src/near/outlayer/setup-preview", () => ({ previewSetupQuote: vi.fn(async ({ asset }: { asset: "USDC" | "NEAR" }) => ({ status: "unavailable", asset, reason: "Fixture only" })) }));

function fixture() {
  vi.stubEnv("APP_ORIGIN", "http://localhost:3101");
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = keys.publicKey.export({ format: "jwk" });
  const publicKey = Buffer.from(isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))], [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))]]))).toString("base64url");
  let state = emptyState();
  state.accounts.a = { id: "a", kind: "passkey", credentialId: "c3ludGhldGlj", publicKey, counter: 0, intentsAccountId: "original" };
  state.sessions[hash("session")] = { accountId: "a", expires: Date.now() + 60_000 };
  const store: StateStore = { read: fn => fn(structuredClone(state)), transaction: fn => { const draft = structuredClone(state); const result = fn(draft); state = draft; return result; } };
  const context = (route: string, ceremony?: string, body: Record<string, unknown> = {}) => ({ route, ceremony, body, account: structuredClone(state.accounts.a), store, session: "session", deployment: getDeploymentConfig(), url: new URL("http://localhost:3101/api/near/outlayer"), simulator: simulateProbe, balanceReader: readBalances });
  const check = vi.fn(async () => {}); // RPC deliberately mocked; not a live mainnet proof.
  async function prepared() {
    const result = await runOutlayerSetup(context("outlayer/owner/prepare"), check);
    return result!.cookies[0].value;
  }
  function assertion(ceremony: string, storedChallenge?: string): AuthenticationResponseJSON {
    const challenge = storedChallenge ?? state.challenges[hash(ceremony)].value;
    const client = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: "http://localhost:3101", crossOrigin: false }));
    const auth = Buffer.concat([createHash("sha256").update("localhost").digest(), Buffer.from([5]), Buffer.from([0, 0, 0, 1])]);
    const signature = sign("sha256", Buffer.concat([auth, createHash("sha256").update(client).digest()]), keys.privateKey);
    return { id: "c3ludGhldGlj", rawId: "c3ludGhldGlj", type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: client.toString("base64url"), authenticatorData: auth.toString("base64url"), signature: signature.toString("base64url") } };
  }
  return { store, context, check, prepared, assertion };
}
afterEach(() => vi.unstubAllEnvs());

test("real synthetic WebAuthn proof records compatibility, preserves Original, and rejects replay", async () => {
  const f = fixture();
  const ceremony = await f.prepared();
  const proof = f.assertion(ceremony);
  await runOutlayerSetup(f.context("outlayer/owner/verify", ceremony, proof as unknown as Record<string, unknown>), f.check);
  const account = await f.store.read(s => s.accounts.a);
  expect(account.outlayerOwnerCheck?.phase).toBe("verified");
  expect(account.counter).toBe(1);
  expect(account.intentsAccountId).toBe("original");
  expect(outlayerSetupView(account)).toMatchObject({ canProvision: false, owner: "verified", network: "mainnet" });
  await expect(runOutlayerSetup(f.context("outlayer/owner/verify", ceremony, proof as unknown as Record<string, unknown>), f.check)).rejects.toThrow();
});

test.each(["other-account", "other-session", "changed-key", "expired", "invalid-signature"])("rejects %s without recording ownership", async reason => {
  const f = fixture(); const ceremony = await f.prepared();
  const proof = f.assertion(ceremony);
  if (reason === "invalid-signature") proof.response.signature = Buffer.alloc(70).toString("base64url");
  if (reason === "other-account") await f.store.transaction(s => { s.challenges[hash(ceremony)].accountId = "other"; });
  if (reason === "other-session") await f.store.transaction(s => { s.challenges[hash(ceremony)].outlayerOwner!.sessionHash = hash("other"); });
  if (reason === "changed-key") await f.store.transaction(s => { s.challenges[hash(ceremony)].outlayerOwner!.publicKey = "changed"; });
  if (reason === "expired") await f.store.transaction(s => { s.challenges[hash(ceremony)].expires = 0; });
  await expect(runOutlayerSetup(f.context("outlayer/owner/verify", ceremony, proof as unknown as Record<string, unknown>), f.check)).rejects.toThrow();
  expect(await f.store.read(s => s.accounts.a.outlayerOwnerCheck)).toBeUndefined();
});

test("failed RPC check and revoked session fail closed", async () => {
  const f = fixture();
  await expect(runOutlayerSetup(f.context("outlayer/owner/prepare"), async () => { throw new Error("RPC unavailable"); })).rejects.toThrow();
  expect(await f.store.read(s => Object.keys(s.challenges))).toHaveLength(0);
  const ceremony = await f.prepared(); const proof = f.assertion(ceremony);
  await expect(runOutlayerSetup(f.context("outlayer/owner/verify", ceremony, proof as unknown as Record<string, unknown>), async () => { await f.store.transaction(s => { delete s.sessions[hash("session")]; }); })).rejects.toThrow();
  expect(await f.store.read(s => s.accounts.a.outlayerOwnerCheck)).toBeUndefined();
});

test("deterministic controller derivation rejects non-P256 keys; saved proof becomes stale after key change", async () => {
  const f = fixture(); const a = await f.store.read(s => s.accounts.a);
  expect(ownerPlan(a.publicKey!)).toEqual(ownerPlan(a.publicKey!));
  expect(ownerPlan(a.publicKey!).controllerId).toMatch(/^0s[0-9a-f]{40}$/);
  expect(() => ownerPlan(Buffer.from(isoCBOR.encode(new Map([[1, 1]]))).toString("base64url"))).toThrow();
  const ceremony = await f.prepared(); await runOutlayerSetup(f.context("outlayer/owner/verify", ceremony, f.assertion(ceremony) as unknown as Record<string, unknown>), f.check);
  const saved = await f.store.read(s => s.accounts.a); saved.credentialId = "replacement";
  expect(outlayerSetupView(saved).owner).toBe("unchecked");
});

test("UI refuses duplicate checks and late completions; failure requires explicit retry", async () => {
  const f = fixture(); const setup = outlayerSetupView(await f.store.read(s => s.accounts.a));
  const loading = { phase: "loading" } as const;
  expect(nextSetup(loading, { type: "check" })).toBeUndefined();
  const review = nextSetup(loading, { type: "loaded", setup })!;
  const checking = nextSetup(review, { type: "check" })!;
  expect(nextSetup(checking, { type: "check" })).toBeUndefined();
  expect(setupPresentation(checking)).toMatchObject({ busy: true, action: null });
  const failed = nextSetup(checking, { type: "failed", message: "Cancelled" })!;
  expect(nextSetup(failed, { type: "loaded", setup })).toBeUndefined();
  expect(setupPresentation(failed)).toMatchObject({ busy: false, action: "retry", error: "Cancelled" });
  expect(nextSetup(failed, { type: "retry" })).toEqual(loading);
});

test("same-origin admission protects preview POSTs and setup GET requires a session", async () => {
  const f = fixture();
  const prepare = await handleNear(new NextRequest("http://localhost:3101/api/near/outlayer/owner/prepare", { method: "POST", headers: { origin: "https://other.invalid", "content-type": "application/json", cookie: "near_session=session" }, body: "{}" }), ["outlayer", "owner", "prepare"], f.store);
  expect(prepare.status).toBe(403);
  const anonymous = await handleNear(new NextRequest("http://localhost:3101/api/near/outlayer/setup"), ["outlayer", "setup"], f.store);
  expect(anonymous.ok).toBe(false);
  expect(await f.store.read(s => Object.keys(s.challenges))).toHaveLength(0);
});

test("mainnet byte pin rejects mismatched or unavailable code", async () => {
  const { checkPublishedOwnerCode } = await import("../src/near/outlayer/owner");
  const changed = vi.fn<typeof fetch>(async () => Response.json({ result: { code_base64: Buffer.from("different WASM").toString("base64") } }));
  await expect(checkPublishedOwnerCode(changed)).rejects.toThrow(/changed/);
  expect(changed.mock.calls[0][1]?.body).toContain("view_global_contract_code_by_account_id");
  const unavailable = vi.fn<typeof fetch>(async () => new Response("unavailable", { status: 503 }));
  await expect(checkPublishedOwnerCode(unavailable)).rejects.toThrow(/unavailable/);
});


test("owner check survives the real local D1 serialization and challenge lifecycle", async () => {
  vi.stubEnv("FINANCIAL_HISTORY_ACTIVE_KEY_ID", "test");
  vi.stubEnv("FINANCIAL_HISTORY_KEYS", JSON.stringify({ test: "b".repeat(64) }));
  const { harness, origin } = await import("./d1-harness");
  const { D1Store } = await import("../src/near/repositories/d1-store");
  const { StatementBudget } = await import("../src/near/repositories/request-budget");
  const h = await harness();
  try {
    const f = fixture();
    const store = new D1Store(h.db, origin, new StatementBudget("paid"));
    const seed = await f.store.read(s => s);
    await store.transaction(s => { s.accounts = seed.accounts; s.sessions = seed.sessions; });
    const prepared = await runOutlayerSetup({ ...f.context("outlayer/owner/prepare"), store }, f.check);
    const ceremony = prepared!.cookies[0].value;
    const challenge = await store.read(s => s.challenges[hash(ceremony)].value);
    const proof = f.assertion(ceremony, challenge);
    await runOutlayerSetup({ ...f.context("outlayer/owner/verify", ceremony, proof as unknown as Record<string, unknown>), store }, f.check);
    const account = await new D1Store(h.db, origin, new StatementBudget("paid")).read(s => s.accounts.a);
    expect(outlayerSetupView(account).owner).toBe("verified");
    expect(account.intentsAccountId).toBe("original");
    expect(await store.read(s => s.challenges[hash(ceremony)])).toBeUndefined();
  } finally { await h.mf.dispose(); }
});


test("successful check has explicit confirmation and refuses repeat clicks or late errors", async () => {
  const f = fixture(); const setup = { ...outlayerSetupView(await f.store.read(s => s.accounts.a)), owner: "verified" as const, checkedAt: Date.now() };
  const complete = nextSetup({ phase: "checking", setup }, { type: "loaded", setup })!;
  expect(complete.phase).toBe("verified");
  expect(setupPresentation(complete)).toMatchObject({ label: "Passkey verified", disabled: true, busy: false, success: true, action: null });
  expect(nextSetup(complete, { type: "check" })).toBeUndefined();
  expect(nextSetup(complete, { type: "failed", message: "late error" })).toBeUndefined();
  const unconfirmed = nextSetup({ phase: "checking", setup }, { type: "loaded", setup: { ...setup, owner: "unchecked" } })!;
  expect(unconfirmed.phase).toBe("error");
});

test("setup quote endpoint accepts only a payment asset and derives the account identity server-side", async () => {
  const f = fixture();
  await f.store.transaction(s => { s.accounts.a.intentsAccountId = `0x${"a".repeat(40)}`; });
  const result = await runOutlayerSetup(f.context("outlayer/quote/preview", undefined, { asset: "USDC" }), f.check);
  expect(result?.body).toMatchObject({ quote: { status: "unavailable", asset: "USDC" } });
  expect(vi.mocked(previewSetupQuote)).toHaveBeenCalledWith(expect.objectContaining({ asset: "USDC", publicKey: expect.any(String), identity: expect.stringMatching(/^0x[0-9a-f]{40}$/) }));
  for (const extra of [{ payer: "attacker.near" }, { amount: "1" }, { costs: {} }, { publicKey: "other" }]) {
    await expect(runOutlayerSetup(f.context("outlayer/quote/preview", undefined, { asset: "NEAR", ...extra }), f.check)).rejects.toThrow();
  }
});


test("mutable pilot identity preserves publisher compatibility and differs from the immutable candidate", async () => {
  const f = fixture();
  const account = await f.store.read(s => s.accounts.a);
  const current = ownerPlan(account.publicKey!);
  const candidate = immutableOwnerPlan(account.publicKey!);
  expect(current.controllerId).not.toBe(candidate.controllerId);
  expect(current.codeHash).toBe(candidate.codeHash);
  account.outlayerOwnerCheck = { phase: "verified", publicKey: account.publicKey!, credentialId: account.credentialId!, controllerId: current.controllerId, codeHash: current.codeHash, checkedAt: Date.now() };
  expect(outlayerSetupView(account)).toMatchObject({ owner: "verified", controllerId: current.controllerId, canProvision: false });
});

test('scoped GET setup and status reject another account before any provider reads',async()=>{
 const f=fixture();
 for(const route of ['setup','activation/status']){
  const r=await handleNear(new NextRequest(`http://localhost:3101/api/near/outlayer/${route}?account=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,{headers:{cookie:'near_session=session'}}),['outlayer',...route.split('/')],f.store);
  expect(r.status).toBe(400);
 }
});
