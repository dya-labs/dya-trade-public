import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { preparePolicyUpdateVote } from "../src/near/outlayer/controller-vote";

const expected = {
  approvalId: "729afe43-7cb8-44f0-a1bd-a0d1d05a2e3d",
  controllerId: "0s" + "a".repeat(40),
  walletPublicKey: "b".repeat(64),
  policyHash: "c".repeat(64),
  currentVersion: 1,
};
const operation = {
  caller: expected.controllerId,
  kind: "policy_update",
  locked: true,
  policy_hash: expected.policyHash,
  version: 3,
  wallet_pubkey: `ed25519:${expected.walletPublicKey}`,
};

function provider(op: typeof operation, expires = Date.now() + 60_000) {
  const canonical = JSON.stringify(op);
  const requestHash = createHash("sha256").update(canonical).digest("hex");
  const fetcher = (async (url: string) => String(url).includes("/approval/")
    ? Response.json({ id: expected.approvalId, expires_at: new Date(expires).toISOString(), wallet_pubkey: operation.wallet_pubkey, request_hash: requestHash, op_canonical: canonical })
    : Response.json({ result: { header: { timestamp_nanosec: "1794661699000000000" } } })) as typeof fetch;
  return { fetcher, requestHash };
}

test("binds an OutLayer policy vote to the exact approved operation", async () => {
  const { fetcher, requestHash } = provider(operation);
  const result = await preparePolicyUpdateVote(expected, fetcher);
  expect(result.version).toBe(3);
  expect(result.message.payload).toBe(`approve:${expected.approvalId}:${operation.wallet_pubkey}:${requestHash}`);
});

test("rejects a self-consistent hash of a different policy", async () => {
  const { fetcher } = provider({ ...operation, policy_hash: "d".repeat(64) });
  await expect(preparePolicyUpdateVote(expected, fetcher)).rejects.toThrow("operation mismatch");
});

test("rejects an expired approval before preparing the controller challenge", async () => {
  const { fetcher } = provider(operation, Date.now() - 1000);
  await expect(preparePolicyUpdateVote(expected, fetcher)).rejects.toThrow("approval expired");
});
