import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
export function authenticator(origin: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const id = randomBytes(32);
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
    ]),
  );
  const rp = createHash("sha256").update(new URL(origin).hostname).digest();
  const client = (challenge: string, type: string, responseOrigin = origin, topOrigin?: string) =>
    Buffer.from(
      JSON.stringify({
        type,
        challenge,
        origin: responseOrigin,
        crossOrigin: Boolean(topOrigin),
        ...(topOrigin ? { topOrigin } : {}),
      }),
    );
  return {
    id: id.toString("base64url"),
    publicKey: Buffer.from(cose).toString("base64url"),
    registration(challenge: string, responseOrigin = origin) {
      const size = Buffer.alloc(2);
      size.writeUInt16BE(id.length);
      const authData = Buffer.concat([
        rp,
        Buffer.from([0x45]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        size,
        id,
        cose,
      ]);
      const att = isoCBOR.encode(
        new Map<string, string | Uint8Array | Map<string, string>>([
          ["fmt", "none"],
          ["authData", new Uint8Array(authData)],
          ["attStmt", new Map()],
        ]),
      );
      return {
        id: id.toString("base64url"),
        rawId: id.toString("base64url"),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: client(
            challenge,
            "webauthn.create",
            responseOrigin,
          ).toString("base64url"),
          attestationObject: Buffer.from(att).toString("base64url"),
          transports: ["internal"],
        },
      };
    },
    assertion(
      challenge: string,
      counter: number,
      responseOrigin = origin,
      uv = true,
      topOrigin?: string,
    ) {
      const count = Buffer.alloc(4);
      count.writeUInt32BE(counter);
      const authData = Buffer.concat([rp, Buffer.from([uv ? 5 : 1]), count]);
      const data = client(challenge, "webauthn.get", responseOrigin, topOrigin);
      const signature = sign(
        "sha256",
        Buffer.concat([authData, createHash("sha256").update(data).digest()]),
        privateKey,
      );
      return {
        id: id.toString("base64url"),
        rawId: id.toString("base64url"),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: data.toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
      };
    },
  };
}
