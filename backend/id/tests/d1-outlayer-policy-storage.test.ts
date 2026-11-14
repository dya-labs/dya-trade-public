import { expect, test, vi } from "vitest";
import { estimatePolicyStorage, OUTLAYER_POLICY_CODE_HASH } from "../src/near/outlayer/policy-storage";
const input = { walletPublicKey: "a".repeat(64), encryptedPolicy: Buffer.from("synthetic-test-only").toString("base64") };
function fixture(codeHash = OUTLAYER_POLICY_CODE_HASH, estimateBlock = "finalized-block", amount: unknown = "6660000000000000000000") {
  return vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ result: { code_hash: codeHash, block_hash: "finalized-block", block_height: 42 } })).mockResolvedValueOnce(Response.json({ result: { result: [...Buffer.from(JSON.stringify(amount))], block_hash: estimateBlock } }));
}
test("pins the storage view to the reviewed deployment and exact finalized block, retaining integer precision", async () => {
  const fetcher = fixture();
  expect(await estimatePolicyStorage(input, fetcher)).toMatchObject({ kind: "policy-storage", network: "mainnet", yoctoNear: "6660000000000000000000", blockHash: "finalized-block" });
  const calls = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  expect(calls.every(call => call.method === "query")).toBe(true);
  expect(calls[1].params.block_id).toBe("finalized-block");
  expect(JSON.parse(Buffer.from(calls[1].params.args_base64, "base64").toString())).toEqual({ wallet_pubkey: `ed25519:${input.walletPublicKey}`, encrypted_data: input.encryptedPolicy });
});
test("stops before estimation if the deployment changed", async () => {
  const fetcher = fixture("changed");
  await expect(estimatePolicyStorage(input, fetcher)).rejects.toThrow("contract changed");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("rejects mixed-block or non-integer responses rather than producing a payable quote", async () => {
  await expect(estimatePolicyStorage(input, fixture(undefined, "other-block"))).rejects.toThrow("block changed");
  await expect(estimatePolicyStorage(input, fixture(undefined, undefined, 666))).rejects.toThrow();
});
test("rejects malformed ciphertext and malformed beneficiary accounts before network access", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(estimatePolicyStorage({ ...input, encryptedPolicy: "not base64" }, fetcher)).rejects.toThrow();
  await expect(estimatePolicyStorage({ ...input, storageRefundTo: "https://payer.near" } as typeof input, fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
test("fails closed for an RPC-level contract error", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: -32000 } }));
  await expect(estimatePolicyStorage(input, fetcher)).rejects.toThrow("not confirmed");
});

test("includes an explicitly chosen refund beneficiary in the exact storage estimate", async () => {
  const fetcher = fixture();
  await estimatePolicyStorage({ ...input, storageRefundTo: "payer.near" }, fetcher);
  const call = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
  expect(JSON.parse(Buffer.from(call.params.args_base64, "base64").toString()).storage_refund_to).toBe("payer.near");
});
