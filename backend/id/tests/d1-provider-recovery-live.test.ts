import { expect, test, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { authenticator } from "./fixtures/authenticator";
import { harness, origin } from "./d1-harness";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { handleNear } from "../src/near/http/api";
import { addressFromPublicKey, hashPersonalMessage } from "../src/near/auth/recovery-wallet";
import { createConfidentialOwnershipProbe, encodeAssertion } from "../src/near/auth/intents";
import { authenticateConfidential } from "../src/near/providers/confidential";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { recoveryProvider } from "../src/near/providers/recovery";
import { confidentialSessionBalances } from "../src/near/services/confidential-sessions";
const enabled = process.env.DYA_ID_RUN_PROVIDER_RECOVERY === "1";

/** Opt-in live MAINNET key changes on a fresh unfunded identity only. Never transfers funds. */
test.skipIf(!enabled)("live_relay_enrollment_rotation_confidential_access_and_revocation", async () => {
  if (!process.env.ONE_CLICK_JWT) throw new Error("Configure ONE_CLICK_JWT before running live recovery verification.");
  const h = await harness();
  const wallet = randomBytes(32); const address = addressFromPublicKey(secp256k1.getPublicKey(wallet, false));
  const sign = (message: string) => { const s = secp256k1.sign(hashPersonalMessage(message), wallet, { prehash: false, format: "recovered" }); return `0x${Buffer.from(s.slice(1)).toString("hex")}${(27+s[0]).toString(16)}`; };
  const store = () => new D1Store(h.db, origin, new StatementBudget("paid"));
  vi.stubEnv("APP_ORIGIN", origin); vi.stubEnv("DYA_ID_LOCAL_RECOVERY", "0"); vi.stubEnv("DYA_ID_PROVIDER_RECOVERY", "1");
  vi.stubEnv("CONFIDENTIAL_SESSION_KEY", randomBytes(32).toString("hex")); vi.stubEnv("INTERNAL_ACCESS_PASSWORD", "");
  const browser = () => {
    const jar: Record<string,string> = {};
    return { jar, async call(path: string, body?: unknown) {
      const response = await handleNear(new NextRequest(`${origin}/api/near/${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin, "content-type": "application/json", cookie: Object.entries(jar).map(([k,v])=>`${k}=${v}`).join("; ") }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), path.split("/"), store());
      const data = await response.json();
      expect(response.status, `Live recovery endpoint ${path}: ${typeof data.error === "string" ? data.error : "unexpected status"}`).toBe(200);
      for (const cookie of response.cookies.getAll()) { if (cookie.value) jar[cookie.name] = cookie.value; else delete jar[cookie.name]; }
      return data;
    } };
  };
  const stage = (b: ReturnType<typeof browser>, path: string, body: unknown = {}) => b.call(`recovery/provider/${path}`, body);
  async function confirmation(b: ReturnType<typeof browser>, expected: string) {
    for (let i=0;i<24;i++) {
      const status = await stage(b, "status");
      if (status.phase === expected) return status;
      if (status.phase === "rejected") throw new Error("Live relay rejected key management; funded recovery is not verified.");
      expect(status.pending || String(status.phase).endsWith("_pending")).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error("Live key change is unconfirmed. Do not repeat the publication.");
  }
  try {
    const b = browser(), old = authenticator(origin), replacement = authenticator(origin);
    const register = await b.call("auth/register/options", {}); await b.call("auth/register/verify", old.registration(register.challenge));
    const initial = (await b.call("state")).account;
    let result = await stage(b, "enroll/options", { address, chainId: 1 });
    result = await stage(b, "enroll/proof", { signature: sign(result.message) });
    await stage(b, "enroll/submit", old.assertion(result.options.challenge, 1));
    result = await confirmation(b, "enroll_auth");
    result = await stage(b, "enroll/verify", { signature: sign(result.message) }); expect(result.phase).toBe("complete");
    const recovery = browser();
    result = await stage(recovery, "recover/options", { recoveryId: initial.id, address, chainId: 1 });
    result = await stage(recovery, "recover/register", replacement.registration(result.options.challenge));
    await stage(recovery, "recover/add", { signature: sign(result.message) });
    result = await confirmation(recovery, "recover_test");
    result = await stage(recovery, "recover/test", replacement.assertion(result.options.challenge, 1));
    await stage(recovery, "recover/remove", { signature: sign(result.message) });
    result = await confirmation(recovery, "recover_finish");
    result = await stage(recovery, "recover/finish", replacement.assertion(result.options.challenge, 2)); expect(result.phase).toBe("complete");
    const snapshot = (await recovery.call("state")).account;
    expect(snapshot.id).toBe(initial.id); expect(snapshot.intentsIdentity.accountId).toBe(initial.intentsIdentity.accountId);
    expect(await recoveryProvider.hasKey(initial.intentsIdentity.accountId, initial.intentsIdentity.publicKey)).toBe(false);
    const balance = await confidentialSessionBalances(store(), recovery.jar.near_session, initial.id);
    expect(balance.balances).toHaveLength(0);
    const revokedProof = createConfidentialOwnershipProbe(initial.intentsIdentity, await recoveryProvider.salt());
    await expect(authenticateConfidential(encodeAssertion(initial.intentsIdentity, revokedProof.payload, old.assertion(revokedProof.challenge.toString("base64url"), 2) as unknown as AuthenticationResponseJSON))).rejects.toThrow(/authentication rejected/);
    console.info("recovery.live.acceptance", { relayKeyChanges: 3, originalWalletPreserved: true, replacementConfidentialAccess: true, oldKeyRevoked: true, revokedKeyProviderAuthRejected: true, funded: false, fundsMoved: false });
  } finally { await h.mf.dispose(); vi.unstubAllEnvs(); }
}, 180000);
