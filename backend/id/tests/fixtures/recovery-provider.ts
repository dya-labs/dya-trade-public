import { base58 } from "@scure/base";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { recoverPersonalSignPublicKey } from "../../src/near/auth/recovery-wallet";
import { recoveryIntentHash, type SignedRecoveryIntent } from "../../src/near/providers/recovery";

/** Mock provider transport with real signature checks. This is not live-chain evidence. */
export function recoveryProviderTransport() {
  const keys = new Map<string, Set<string>>();
  const revoked = new Map<string, Set<string>>();
  const submitted = new Map<string, { accountId: string; changes: { intent: string; public_key: string }[]; settled: boolean }>();
  const credentials = new Map<string, string>();
  const balances = new Map<string, { tokenId: string; available: string; source: "private" }[]>();
  const authSigners: { accountId: string; key: string }[] = [];
  const publications: SignedRecoveryIntent[] = [];
  let pending = false, ambiguous = false, reject = false, authRejected = false;
  function isKey(id: string, key: string) {
    if (revoked.get(id)?.has(key)) return false;
    if (keys.get(id)?.has(key)) return true;
    const [curve, encoded] = key.split(":");
    const raw = base58.decode(encoded);
    const implicit = `0x${Buffer.from(keccak_256(curve === "p256" ? Buffer.concat([Buffer.from("p256"), raw]) : raw).slice(12)).toString("hex")}`;
    return implicit === id;
  }
  function signer(signed: SignedRecoveryIntent) {
    if (signed.standard === "erc191") {
      const raw = Buffer.from(base58.decode(signed.signature.slice("secp256k1:".length)));
      return recoverPersonalSignPublicKey(signed.payload, `0x${raw.toString("hex")}`);
    }
    const rawKey = base58.decode(signed.public_key.slice("p256:".length));
    const pub = Buffer.concat([Buffer.from([4]), rawKey]);
    const hash = sha256(Buffer.concat([Buffer.from(signed.authenticator_data, "base64url"), sha256(Buffer.from(signed.client_data_json))]));
    if (!p256.verify(base58.decode(signed.signature.slice("p256:".length)), hash, pub, { prehash: false })) throw new Error("Synthetic provider signature rejected");
    return signed.public_key;
  }
  function settle(hash: string) {
    const op = submitted.get(hash)!;
    if (op.settled) return;
    const account = keys.get(op.accountId) ?? new Set<string>(); keys.set(op.accountId, account);
    const removed = revoked.get(op.accountId) ?? new Set<string>(); revoked.set(op.accountId, removed);
    for (const c of op.changes) { if (c.intent === "add_public_key") { account.add(c.public_key); removed.delete(c.public_key); } else { account.delete(c.public_key); removed.add(c.public_key); } }
    op.settled = true;
  }
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("rpc.mainnet")) {
      const { params } = JSON.parse(String(init?.body)); const args = JSON.parse(Buffer.from(params.args_base64, "base64").toString());
      const value = params.method_name === "current_salt" ? "e110f317" : isKey(args.account_id, args.public_key);
      return json({ result: { result: Array.from(Buffer.from(JSON.stringify(value))), block_height: 100 } });
    }
    if (url.includes("solver-relay")) {
      const { method, params: [params] } = JSON.parse(String(init?.body));
      if (method === "get_status") {
        const op = submitted.get(params.intent_hash);
        return json({ result: { intent_hash: params.intent_hash, status: op?.settled ? "SETTLED" : op ? "PENDING" : "NOT_FOUND_OR_NOT_VALID", ...(op?.settled ? { data: { hash: "synthetic-finalized-tx" } } : {}) } });
      }
      const signed = params.signed_data as SignedRecoveryIntent;
      const p = JSON.parse(signed.payload); publications.push(signed);
      if (reject || !isKey(p.signer_id, signer(signed))) return json({ result: { status: "FAILED" } });
      const hash = recoveryIntentHash(signed);
      submitted.set(hash, { accountId: p.signer_id, changes: p.intents, settled: false });
      if (!pending) settle(hash);
      if (ambiguous) throw new Error("Synthetic disconnect after accepted publication");
      return json({ result: { status: "OK", intent_hash: hash } });
    }
    if (url.endsWith("/auth/authenticate")) {
      const { signedData } = JSON.parse(String(init?.body)); const p = JSON.parse(signedData.payload); const key = signer(signedData);
      if (authRejected || !isKey(p.signer_id, key) || p.intents.length) return json({ error: "Synthetic rejection" }, 401);
      const accessToken = `synthetic-${credentials.size}`; credentials.set(accessToken, p.signer_id); authSigners.push({ accountId: p.signer_id, key });
      return json({ accessToken, refreshToken: `refresh-${accessToken}`, expiresIn: 3600, refreshExpiresIn: 7200 });
    }
    if (url.endsWith("/account/balances")) {
      const bearer = new Headers(init?.headers).get("authorization")!.slice(7);
      const id = credentials.get(bearer); if (!id) return json({}, 401);
      return json({ balances: balances.get(id) ?? [] });
    }
    throw new Error("Unexpected provider request");
  };
  return { fetcher, balances, keys, publications, authSigners, isKey, settleAll: () => { for (const hash of submitted.keys()) settle(hash); }, setPending: (v: boolean) => { pending = v; }, setAmbiguous: (v: boolean) => { ambiguous = v; }, setRejected: (v: boolean) => { reject = v; }, setAuthRejected: (v: boolean) => { authRejected = v; } };
}
