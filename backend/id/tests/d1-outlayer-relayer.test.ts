import { createPrivateKey, createPublicKey } from "node:crypto";
import { base58 } from "@scure/base";
import { expect, test, vi } from "vitest";
import { readRelayerReadiness, relayerPublicConfiguration } from "../src/near/outlayer/relayer";
function fixture() {
  const seed = Buffer.alloc(32, 7);
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  const pub = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32);
  return { OUTLAYER_RELAYER_ACCOUNT_ID: pub.toString("hex"), OUTLAYER_RELAYER_PRIVATE_KEY: `ed25519:${base58.encode(Buffer.concat([seed, pub]))}` };
}
test("derives a matching public configuration and never returns the secret", () => {
  const env = fixture(); const result = relayerPublicConfiguration(env)!;
  expect(result.accountId).toBe(env.OUTLAYER_RELAYER_ACCOUNT_ID);
  expect(Object.keys(result).sort()).toEqual(["accountId", "publicKey"]);
  expect(JSON.stringify(result)).not.toContain(env.OUTLAYER_RELAYER_PRIVATE_KEY);
});
test("rejects mismatched IDs, altered public suffix, missing and malformed keys without leaking input", () => {
  const env = fixture();
  for (const changed of [ { ...env, OUTLAYER_RELAYER_ACCOUNT_ID: "a".repeat(64) }, { ...env, OUTLAYER_RELAYER_PRIVATE_KEY: "ed25519:private-do-not-print" }, { OUTLAYER_RELAYER_ACCOUNT_ID: env.OUTLAYER_RELAYER_ACCOUNT_ID } ]) {
    expect(() => relayerPublicConfiguration(changed)).toThrow("configuration is invalid");
    try { relayerPublicConfiguration(changed); } catch (error) { expect(String(error)).not.toContain(("OUTLAYER_RELAYER_PRIVATE_KEY" in changed ? changed.OUTLAYER_RELAYER_PRIVATE_KEY : "private-do-not-print")); }
  }
});
test("unconfigured readiness does no network work", async () => {
  const fetcher = vi.fn<typeof fetch>();
  expect(await readRelayerReadiness(fetcher, {})).toEqual({ status: "unconfigured", submissionEnabled: false });
  expect(fetcher).not.toHaveBeenCalled();
});
function rpcFixture(permission: string = "FullAccess", storage: unknown = null, block = "final-block") {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const kind = request.params.request_type;
    if (kind === "view_account") return Response.json({ result: { amount: "1000000000000000000000000", block_hash: "final-block", block_height: 42 } });
    expect(request.params.block_id).toBe("final-block");
    if (request.params.method_name === "storage_balance_bounds") return Response.json({ result: { result: [...Buffer.from(JSON.stringify({ min: "1250000000000000000000" }))], block_hash: block } });
    return Response.json({ result: kind === "view_access_key" ? { permission, block_hash: block } : { result: [...Buffer.from(JSON.stringify(storage))], block_hash: block } });
  });
}
test("verifies key authority, native funding without wNEAR registration without enabling submission", async () => {
  const fetcher = rpcFixture();
  expect(await readRelayerReadiness(fetcher, fixture())).toMatchObject({ status: "verified", nativeBalanceYoctoNear: "1000000000000000000000000", submissionEnabled: false });
  expect(fetcher.mock.calls.every(([, init]) => JSON.parse(String(init?.body)).method === "query")).toBe(true);
});
test("rejects changed authority or mixed-block data", async () => {
  await expect(readRelayerReadiness(rpcFixture("FunctionCall"), fixture())).rejects.toThrow();
  await expect(readRelayerReadiness(rpcFixture(undefined, null, "other-block"), fixture())).rejects.toThrow();
});
test("never queries wNEAR storage for native NEAR readiness", async () => {
  const fetcher = rpcFixture();
  await readRelayerReadiness(fetcher, fixture());
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).params.request_type)).toEqual(["view_account", "view_access_key"]);
});
