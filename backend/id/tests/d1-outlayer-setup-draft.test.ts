import { generateKeyPairSync } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { afterEach, expect, test, vi } from "vitest";
import { prepareSetupDraft } from "../src/near/outlayer/setup-draft";
import { emptyState, hash, type StateStore } from "../src/near/repositories/store";
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv("CONFIDENTIAL_SESSION_KEY", "a".repeat(64));
  const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" });
  const publicKey = Buffer.from(isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))], [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))]]))).toString("base64url");
  let state = emptyState();
  const account = { id: "a", kind: "passkey" as const, credentialId: "credential", publicKey };
  state.accounts.a = account; state.sessions[hash("session")] = { accountId: "a", expires: Date.now() + 60000 };
  const store: StateStore = { read: fn => fn(structuredClone(state)), transaction: fn => { const draft = structuredClone(state); const result = fn(draft); state = draft; return result; } };
  return { store, account };
}
const apiKey = "wk_synthetic_secret_never_return";
const registered = { wallet_id: "11111111-1111-4111-8111-111111111111", near_account_id: "a".repeat(64), api_key: apiKey };
const policyCiphertext = Buffer.from("real-provider-ciphertext-fixture").toString("base64");
function fetcher() {
  return vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("/register")) return Response.json(registered);
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${apiKey}` });
    const policy = JSON.parse(String(init?.body));
    expect(policy.approval.locked).toBe(true);
    expect(Object.values(policy.capabilities).every(value => !(value as { allowed: boolean }).allowed)).toBe(true);
    return Response.json({ encrypted_base64: policyCiphertext, wallet_pubkey: registered.near_account_id, policy_hash: "b".repeat(64) });
  });
}
test("persists one encrypted credential, prices a real policy draft, and reuses it across reloads", async () => {
  const f = fixture(), remote = fetcher();
  const draft = await prepareSetupDraft(f.store, "session", f.account, remote);
  expect(draft.phase).toBe("policy-ready");
  expect(JSON.stringify(await f.store.read(s => s))).not.toContain(apiKey);
  expect(await prepareSetupDraft(f.store, "session", f.account, remote)).toEqual(draft);
  expect(remote).toHaveBeenCalledTimes(2);
});
test("unknown registration never creates another wallet on retry", async () => {
  const f = fixture(), remote = vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout"));
  await expect(prepareSetupDraft(f.store, "session", f.account, remote)).rejects.toThrow("unconfirmed");
  expect((await f.store.read(s => s.accounts.a.outlayerSetupDraft))?.phase).toBe("registration-unknown");
  await expect(prepareSetupDraft(f.store, "session", f.account, remote)).rejects.toThrow("Do not retry");
  expect(remote).toHaveBeenCalledTimes(1);
});
test("preserves an encrypted receipt when registration validation fails", async () => {
  const f = fixture(), remote = vi.fn<typeof fetch>(async () => Response.json({ ...registered, near_account_id: "invalid" }));
  await expect(prepareSetupDraft(f.store, "session", f.account, remote)).rejects.toThrow("unconfirmed");
  const draft = await f.store.read(s => s.accounts.a.outlayerSetupDraft);
  expect(draft).toMatchObject({ phase: "registration-unknown", registrationFailure: "response-validation", registrationHttpStatus: 200 });
  expect(draft?.sealedRegistrationReceipt).toBeTruthy();
  expect(JSON.stringify(draft)).not.toContain(apiKey);
});
test("recovers the saved receipt after credential checkpoint failure without registering again", async () => {
  const f = fixture(), remote = fetcher();
  const original = f.store.transaction.bind(f.store);
  let fail = true;
  f.store.transaction = fn => original(s => {
    const result = fn(s);
    if (fail && s.accounts.a.outlayerSetupDraft?.phase === "registered") {
      fail = false;
      throw new Error("checkpoint unavailable");
    }
    return result;
  });
  await expect(prepareSetupDraft(f.store, "session", f.account, remote)).rejects.toThrow("unconfirmed");
  expect(await f.store.read(s => s.accounts.a.outlayerSetupDraft?.registrationFailure)).toBe("credential-checkpoint");
  expect((await prepareSetupDraft(f.store, "session", f.account, remote)).phase).toBe("policy-ready");
  expect(remote.mock.calls.filter(([url]) => String(url).endsWith("/register"))).toHaveLength(1);
});
test("retries failed encryption with the existing encrypted credential, not another registration", async () => {
  const f = fixture(), remote = fetcher();
  remote.mockImplementationOnce(async () => Response.json(registered)).mockImplementationOnce(async () => new Response("unavailable", { status: 503 }));
  await expect(prepareSetupDraft(f.store, "session", f.account, remote)).rejects.toThrow("draft is preserved");
  expect((await f.store.read(s => s.accounts.a.outlayerSetupDraft))?.phase).toBe("registered");
  await prepareSetupDraft(f.store, "session", f.account, remote);
  expect(remote.mock.calls.filter(([url]) => String(url).endsWith("/register"))).toHaveLength(1);
});
test("does no remote registration without encrypted persistence", async () => {
  const f = fixture(); vi.stubEnv("CONFIDENTIAL_SESSION_KEY", ""); const remote = fetcher();
  await expect(prepareSetupDraft(f.store, "session", f.account, remote)).rejects.toThrow("not configured");
  expect(remote).not.toHaveBeenCalled();
});
test("refuses another owner's or credential's draft rather than decrypting it", async () => {
  const f = fixture(); await prepareSetupDraft(f.store, "session", f.account, fetcher());
  await f.store.transaction(s => { s.accounts.a.credentialId = "replacement"; });
  const account = await f.store.read(s => s.accounts.a);
  await expect(prepareSetupDraft(f.store, "session", account, fetcher())).rejects.toThrow("ownership changed");
});

test("encrypted registration survives a real D1 reload with no plaintext provider key", async () => {
  const { harness, origin } = await import("./d1-harness");
  const { D1Store } = await import("../src/near/repositories/d1-store");
  const { StatementBudget } = await import("../src/near/repositories/request-budget");
  const h = await harness();
  try {
    const f = fixture(), seed = await f.store.read(s => s);
    const store = new D1Store(h.db, origin, new StatementBudget("paid"));
    await store.transaction(s => { s.accounts = seed.accounts; s.sessions = seed.sessions; });
    const remote = fetcher();
    await prepareSetupDraft(store, "session", f.account, remote);
    const reloaded = new D1Store(h.db, origin, new StatementBudget("paid"));
    const account = await reloaded.read(s => s.accounts.a);
    expect(account.outlayerSetupDraft?.phase).toBe("policy-ready");
    expect(JSON.stringify(account)).not.toContain(apiKey);
    expect((await prepareSetupDraft(reloaded, "session", account, remote)).phase).toBe("policy-ready");
    expect(remote).toHaveBeenCalledTimes(2);
  } finally { await h.mf.dispose(); }
});

test("concurrent preparation never registers a second wallet while the first request is in flight", async () => {
  const f = fixture(); let release!: (response: Response) => void;
  const waiting = new Promise<Response>(resolve => { release = resolve; });
  const remote = fetcher().mockImplementationOnce(async () => waiting);
  const first = prepareSetupDraft(f.store, "session", f.account, remote);
  await vi.waitFor(() => expect(remote).toHaveBeenCalledTimes(1));
  await expect(prepareSetupDraft(f.store, "session", f.account, remote)).rejects.toThrow("Do not retry");
  release(Response.json(registered));
  expect((await first).phase).toBe("policy-ready");
  expect(remote.mock.calls.filter(([url]) => String(url).endsWith("/register"))).toHaveLength(1);
});
test("rejects ciphertext for a different wallet and preserves the registered credential", async () => {
  const f = fixture(), remote = fetcher().mockImplementationOnce(async () => Response.json(registered)).mockImplementationOnce(async () => Response.json({ encrypted_base64: policyCiphertext, wallet_pubkey: "c".repeat(64), policy_hash: "b".repeat(64) }));
  await expect(prepareSetupDraft(f.store, "session", f.account, remote)).rejects.toThrow("does not match");
  expect((await f.store.read(s => s.accounts.a.outlayerSetupDraft))?.phase).toBe("registered");
});
test("accepts mainnet's wallet UUID response while preserving the registered chain key", async () => {
  const f = fixture(), remote = fetcher().mockImplementationOnce(async () => Response.json(registered)).mockImplementationOnce(async () => Response.json({ encrypted_base64: policyCiphertext, wallet_pubkey: registered.wallet_id, policy_hash: "b".repeat(64) }));
  const draft = await prepareSetupDraft(f.store, "session", f.account, remote);
  expect(draft.phase).toBe("policy-ready");
  expect("walletPublicKey" in draft && draft.walletPublicKey).toBe(registered.near_account_id);
});
test("rejects another wallet UUID in the mainnet policy response", async () => {
  const f = fixture(), remote = fetcher().mockImplementationOnce(async () => Response.json(registered)).mockImplementationOnce(async () => Response.json({ encrypted_base64: policyCiphertext, wallet_pubkey: "22222222-2222-4222-8222-222222222222", policy_hash: "b".repeat(64) }));
  await expect(prepareSetupDraft(f.store, "session", f.account, remote)).rejects.toThrow("does not match registration");
});
