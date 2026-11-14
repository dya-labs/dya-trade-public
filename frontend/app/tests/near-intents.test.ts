// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { base58 } from "@scure/base";
import { p256 } from "@noble/curves/nist.js";
import {
  createSigningProbe,
  encodeAssertion,
  identityFromRawKey,
  intentsIdentity,
  payloadChallenge,
  simulateProbe,
  validateProbe,
  versionedNonce,
} from "../../../backend/id/src/near/auth/intents";
function fixture(salt = "252812b3") {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const x = new Uint8Array(Buffer.from(jwk.x!, "base64url")),
    y = new Uint8Array(Buffer.from(jwk.y!, "base64url"));
  const cose = Buffer.from(
    isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, x],
        [-3, y],
      ]),
    ),
  ).toString("base64url");
  const identity = intentsIdentity(cose);
  const probe = createSigningProbe(identity, salt);
  const clientData = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge: probe.challenge.toString("base64url"),
      origin: "http://localhost:3100",
      crossOrigin: false,
    }),
  );
  const authData = Buffer.concat([
    createHash("sha256").update("localhost").digest(),
    Buffer.from([5, 0, 0, 0, 1]),
  ]);
  const message = Buffer.concat([
    authData,
    createHash("sha256").update(clientData).digest(),
  ]);
  const der = sign("sha256", message, privateKey);
  const assertion: AuthenticationResponseJSON = {
    id: "synthetic-test",
    rawId: "synthetic-test",
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData.toString("base64url"),
      authenticatorData: authData.toString("base64url"),
      signature: der.toString("base64url"),
    },
  };
  return {
    identity,
    probe,
    assertion,
    message,
    key: Buffer.concat([Buffer.from([4]), x, y]),
  };
}
describe("Intents WebAuthn adapter", () => {
  it("matches the verifier repository’s P-256 account derivation vector", () => {
    const publicKey =
      "p256:2V8Np9vGqLiwVZ8qmMmpkxU7CTRqje4WtwFeLimSwuuyF1rddQK5fELiMgxUnYbVjbZHCNnGc6fAe4JeDcVxgj3Q";
    expect(identityFromRawKey(base58.decode(publicKey.slice(5)))).toEqual({
      publicKey,
      accountId: "0x3602b546589a8fcafdce7fad64a46f91db0e4d50",
    });
  });
  it("serializes a salted expiring V1 nonce with a little-endian nanosecond deadline", () => {
    const nonce = Buffer.from(
      versionedNonce("252812b3", 1800000000000),
      "base64",
    );
    expect(nonce.length).toBe(32);
    expect(nonce.subarray(0, 9).toString("hex")).toBe("5628f6c600252812b3");
    expect(nonce.readBigInt64LE(9)).toBe(BigInt("1800000000000000000"));
    expect(() => versionedNonce("invalid", 1800000000000)).toThrow();
  });
  it("binds the hash to exact payload bytes and preserves clientDataJSON bytes", () => {
    const f = fixture();
    const encoded = encodeAssertion(f.identity, f.probe.payload, f.assertion);
    expect(encoded.client_data_json).toBe(
      Buffer.from(f.assertion.response.clientDataJSON, "base64url").toString(),
    );
    expect(
      p256.verify(base58.decode(encoded.signature.slice(5)), f.message, f.key, {
        lowS: true,
      }),
    ).toBe(true);
    expect(
      payloadChallenge(f.probe.payload).equals(
        payloadChallenge(f.probe.payload + " "),
      ),
    ).toBe(false);
    expect(() =>
      encodeAssertion(f.identity, f.probe.payload + " ", f.assertion),
    ).toThrow("not bound");
  });
  it("normalizes high-S DER signatures to the verifier’s 64-byte low-S format", () => {
    const f = fixture();
    const parsed = p256.Signature.fromBytes(
      Buffer.from(f.assertion.response.signature, "base64url"),
      "der",
    );
    const high = parsed.hasHighS()
      ? parsed
      : new p256.Signature(parsed.r, p256.Point.Fn.ORDER - parsed.s);
    f.assertion.response.signature = Buffer.from(high.toBytes("der")).toString(
      "base64url",
    );
    const encoded = encodeAssertion(f.identity, f.probe.payload, f.assertion);
    const raw = base58.decode(encoded.signature.slice(5));
    expect(raw.length).toBe(64);
    expect(p256.Signature.fromBytes(raw).hasHighS()).toBe(false);
    expect(p256.verify(raw, f.message, f.key, { lowS: true })).toBe(true);
  });
  it("rejects transfer/key-change payloads and wrong signer identities before RPC", () => {
    const f = fixture();
    const encoded = encodeAssertion(f.identity, f.probe.payload, f.assertion);
    for (const intents of [
      [{ intent: "transfer" }],
      [{ intent: "add_public_key" }],
    ])
      expect(() =>
        validateProbe({
          ...encoded,
          payload: JSON.stringify({ ...JSON.parse(f.probe.payload), intents }),
        }),
      ).toThrow("empty");
    expect(() =>
      validateProbe({
        ...encoded,
        payload: JSON.stringify({
          ...JSON.parse(f.probe.payload),
          signer_id: "0x" + "0".repeat(40),
        }),
      }),
    ).toThrow("identity");
  });
  it("only calls the read-only verifier method and validates its exact confirmation", async () => {
    const f = fixture();
    const encoded = encodeAssertion(f.identity, f.probe.payload, f.assertion);
    let body: Record<string, unknown> = {};
    const fetcher: typeof fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      const result = {
        intents_executed: [
          {
            account_id: f.identity.accountId,
            nonce: JSON.parse(f.probe.payload).nonce,
            intent_hash: base58.encode(payloadChallenge(f.probe.payload)),
          },
        ],
        state: { current_salt: "252812b3" },
      };
      return Response.json({
        result: {
          block_height: 123,
          result: [...Buffer.from(JSON.stringify(result))],
        },
      });
    };
    expect((await simulateProbe([encoded], fetcher)).blockHeight).toBe(123);
    expect(body.method).toBe("query");
    expect(body.params).toMatchObject({
      request_type: "call_function",
      method_name: "simulate_intents",
      account_id: "intents.near",
    });
    await expect(
      simulateProbe([encoded], async () =>
        Response.json({
          result: {
            block_height: 123,
            result: [
              ...Buffer.from(
                JSON.stringify({
                  intents_executed: [],
                  state: { current_salt: "252812b3" },
                }),
              ),
            ],
          },
        }),
      ),
    ).rejects.toThrow("did not confirm");
  });
  it.skipIf(process.env.NEAR_LIVE_VERIFY !== "1")(
    "verifies a generated test key through mainnet simulate_intents without state changes",
    async () => {
      const { output } = await simulateProbe();
      const f = fixture(output.state.current_salt);
      const result = await simulateProbe([
        encodeAssertion(f.identity, f.probe.payload, f.assertion),
      ]);
      expect(result.blockHeight).toBeGreaterThan(0);
      expect(result.output.intents_executed[0].account_id).toBe(
        f.identity.accountId,
      );
    },
    30000,
  );
});
