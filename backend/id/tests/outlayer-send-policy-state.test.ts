import { expect, test } from "vitest";
import { nextSendPolicy, sendPolicyState } from "../src/near/outlayer/send-policy-state";

test("policy filing retains the signed bytes until the matching transaction is confirmed", () => {
  const proposed = sendPolicyState.parse({
    phase: "proposed",
    approvalId: "729afe43-7cb8-44f0-a1bd-a0d1d05a2e3d",
    requestId: "e3feddbf-3e1a-45a5-a6ec-f41dce698bf7",
    version: 3,
    policyHash: "a".repeat(64),
    encryptedPolicy: "YQ==",
  });
  const transaction = { hash: "expected", signerId: "payer", receiverId: "controller", bytes: "signed" };
  const signed = { type: "transaction-signed", transaction } as const;
  expect(nextSendPolicy(proposed, signed)).toBeUndefined();
  const voted = nextSendPolicy(proposed, { type: "vote-confirmed" })!;
  const submitted = nextSendPolicy(voted, signed)!;
  expect(submitted).toMatchObject({ phase: "submitted", transaction });
  expect(nextSendPolicy(submitted, signed)).toBeUndefined();
  expect(nextSendPolicy(submitted, { type: "policy-confirmed", transactionHash: "different" })).toBeUndefined();
  expect(nextSendPolicy(submitted, { type: "policy-confirmed", transactionHash: transaction.hash }))
    .toMatchObject({ phase: "confirmed", transactionHash: transaction.hash });
});
