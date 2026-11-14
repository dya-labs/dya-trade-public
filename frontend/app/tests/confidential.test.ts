// @vitest-environment node
import { expect, it, vi } from "vitest";
import { authenticateConfidential, readConfidentialBalances, refreshConfidential } from "../../../backend/id/src/near/providers/confidential";
import type { SignedWebAuthn } from "../../../backend/id/src/near/auth/intents";
const signed: SignedWebAuthn = { standard: "webauthn", payload: JSON.stringify({ intents: [] }), public_key: "test", signature: "test", client_data_json: "test", authenticator_data: "test" };
it("authenticates an empty ownership signature without exposing provider errors", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ accessToken: "access", refreshToken: "refresh", expiresIn: 60, refreshExpiresIn: 600 }));
  expect((await authenticateConfidential(signed, fetcher)).accessToken).toBe("access");
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ signedData: signed });
  await expect(authenticateConfidential(signed, async () => Response.json({ secret: "do-not-expose" }, { status: 403 }))).rejects.toThrow("Confidential authentication rejected (403)");
});
it("rejects authentication payloads containing financial intents before calling the provider", async () => {
  const fetcher = vi.fn();
  await expect(authenticateConfidential({ ...signed, payload: JSON.stringify({ intents: [{ intent: "transfer" }] }) }, fetcher)).rejects.toThrow("must not contain transfer");
  expect(fetcher).not.toHaveBeenCalled();
});
it("accepts only private balances, preserves raw precision, and never falls back", async () => {
  const data = { balances: [{ tokenId: "token", available: "123456789012345678901234", source: "private" }] };
  expect(await readConfidentialBalances("access", async () => Response.json(data))).toEqual(data);
  await expect(readConfidentialBalances("access", async () => Response.json({ balances: [{ ...data.balances[0], source: "public" }] }))).rejects.toThrow();
  await expect(readConfidentialBalances("access", async () => new Response(null, { status: 401 }))).rejects.toThrow("Confirm your passkey");
});
it("requires renewed authentication when refresh is rejected", async () => {
  await expect(refreshConfidential("refresh", async () => new Response(null, { status: 401 }))).rejects.toThrow("Unlock again");
});

it("embeds issuance time and expiry in the ownership nonce using the SDK layout", async () => {
  const { createConfidentialOwnershipProbe } = await import("../../../backend/id/src/near/auth/intents");
  const now = 1790334000000;
  const identity = { accountId: "0x123", publicKey: "unused" };
  const first = createConfidentialOwnershipProbe(identity, "252812b3", now);
  const payload = JSON.parse(first.payload);
  const nonce = Buffer.from(payload.nonce, "base64");
  expect(nonce.length).toBe(32);
  expect(nonce.subarray(0, 9).toString("hex")).toBe("5628f6c600252812b3");
  expect(nonce.readBigUInt64LE(9)).toBe(BigInt(now + 300000) * BigInt(1000000));
  expect(nonce.readBigUInt64LE(17)).toBe(BigInt(now) * BigInt(1000000));
  expect(payload.intents).toEqual([]);
  expect(payload.verifying_contract).toBe("intents.near");
  expect(JSON.parse(createConfidentialOwnershipProbe(identity, "252812b3", now).payload).nonce).not.toBe(payload.nonce);
});
