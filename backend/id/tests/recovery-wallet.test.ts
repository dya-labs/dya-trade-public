import { describe, expect, test } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  FUND_CONTROL_NOTICE,
  RecoveryWalletError,
  addressFromPublicKey,
  buildRecoveryMessage,
  hashPersonalMessage,
  normalizeEvmAddress,
  recoverPersonalSignAddress,
  toChecksumAddress,
  verifyRecoverySignature,
  type RecoveryChallenge,
} from "../src/near/auth/recovery-wallet";

// Synthetic test keys only.
const KEY = Buffer.from("11".repeat(32), "hex");
const OTHER = Buffer.from("22".repeat(32), "hex");
const addressOf = (key: Uint8Array) => addressFromPublicKey(secp256k1.getPublicKey(key, false));
function personalSign(message: string, key: Uint8Array) {
  const rec = secp256k1.sign(hashPersonalMessage(message), key, { prehash: false, format: "recovered" });
  return `0x${Buffer.from(rec.slice(1)).toString("hex")}${(27 + rec[0]).toString(16)}`;
}

const NOW = Date.UTC(2026, 9, 10, 8, 0, 0);
const DOMAIN = "id.example.test";
const challenge = (over: Partial<RecoveryChallenge> = {}): RecoveryChallenge => ({
  purpose: "recover",
  domain: DOMAIN,
  chainId: 1,
  recoveryAddress: addressOf(KEY),
  accountId: `0x${"ab".repeat(20)}`,
  passkeyPublicKey: `p256:${"3".repeat(87)}`,
  nonce: "0123456789abcdef0123456789abcdef",
  issuedAt: NOW,
  expiresAt: NOW + 5 * 60 * 1000,
  ...over,
});

describe("ERC-191 primitives", () => {
  test("matches the published web3.js personal_sign vector", () => {
    // web3.eth.accounts.sign('Some data', 0x4c08…2318)
    expect(Buffer.from(hashPersonalMessage("Some data")).toString("hex")).toBe(
      "1da44b586eb0729ff70a73c326926f6ed5a25f5b056e7f47fbc6e58d86871655",
    );
    const sig =
      "0xb91467e570a6466aa9e9876cbcd013baba02900b8979d43fe208a4a4f339f5fd6007e74cd82e037b800186422fc2da167c747ef045e5d18a5f5d4300f8e1a0291c";
    expect(recoverPersonalSignAddress("Some data", sig)).toBe("0x2c7536e3605d9c16a7a3d7b1898e529396a65c23");
  });

  test("normalizes and checksums addresses (EIP-55)", () => {
    const checksummed = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    expect(toChecksumAddress(checksummed.toLowerCase())).toBe(checksummed);
    expect(normalizeEvmAddress(checksummed)).toBe(checksummed.toLowerCase());
    expect(normalizeEvmAddress(checksummed.toUpperCase().replace("0X", "0x"))).toBe(checksummed.toLowerCase());
    expect(() => normalizeEvmAddress("0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toThrow(RecoveryWalletError);
    expect(() => normalizeEvmAddress("0x1234")).toThrow(RecoveryWalletError);
  });

  test("rejects malformed and high-s signatures", () => {
    const sig = personalSign("x", KEY);
    expect(() => recoverPersonalSignAddress("x", sig.slice(0, -2))).toThrow(RecoveryWalletError);
    expect(() => recoverPersonalSignAddress("x", `${sig.slice(0, -2)}1d`)).toThrow(RecoveryWalletError);
    const raw = Buffer.from(sig.slice(2), "hex");
    const s = BigInt(`0x${raw.subarray(32, 64).toString("hex")}`);
    raw.set(Buffer.from((secp256k1.Point.Fn.ORDER - s).toString(16).padStart(64, "0"), "hex"), 32);
    raw[64] = raw[64] === 27 ? 28 : 27;
    expect(() => recoverPersonalSignAddress("x", `0x${raw.toString("hex")}`)).toThrow(RecoveryWalletError);
  });
});

describe("recovery wallet challenge", () => {
  test("message construction is stable and discloses full fund control", () => {
    const message = buildRecoveryMessage(challenge());
    expect(message).toBe(buildRecoveryMessage(challenge()));
    expect(message).toMatchInlineSnapshot(`
      "id.example.test wants you to sign with your Ethereum account:
      ${toChecksumAddress(addressOf(KEY))}

      Recover my DYA wallet and authorize the replacement passkey below.
      This wallet will have FULL CONTROL of my DYA wallet, including moving all funds. It is not a limited recovery guardian.

      Purpose: recover
      DYA Account: 0xabababababababababababababababababababab
      Passkey: p256:333333333333333333333333333333333333333333333333333333333333333333333333333333333333333
      Chain ID: 1
      Version: 1
      Nonce: 0123456789abcdef0123456789abcdef
      Issued At: 2026-10-10T08:00:00.000Z
      Expiration Time: 2026-10-10T08:05:00.000Z"
    `);
    expect(buildRecoveryMessage(challenge({ purpose: "enroll" }))).toContain(FUND_CONTROL_NOTICE);
  });

  test("valid signature recovers the enrolled address and is flagged full fund control", () => {
    const c = challenge();
    const verified = verifyRecoverySignature(c, personalSign(buildRecoveryMessage(c), KEY), { domain: DOMAIN, now: NOW + 1000 });
    expect(verified.recoveryAddress).toBe(addressOf(KEY));
    expect(verified.fullFundControl).toBe(true);
  });

  test("accepts checksummed expected address and v in {0,1}", () => {
    const c = challenge({ recoveryAddress: toChecksumAddress(addressOf(KEY)) });
    const sig = personalSign(buildRecoveryMessage(c), KEY);
    const v01 = `${sig.slice(0, -2)}0${parseInt(sig.slice(-2), 16) - 27}`;
    expect(verifyRecoverySignature(c, v01, { domain: DOMAIN, now: NOW }).recoveryAddress).toBe(addressOf(KEY));
  });

  test("wrong signer, tampered binding, wrong domain and expiry all fail", () => {
    const c = challenge();
    const good = personalSign(buildRecoveryMessage(c), KEY);
    const code = (fn: () => unknown) => {
      try { fn(); } catch (e) { return (e as RecoveryWalletError).code; }
      return "ok";
    };
    expect(code(() => verifyRecoverySignature(c, personalSign(buildRecoveryMessage(c), OTHER), { domain: DOMAIN, now: NOW }))).toBe("signer_mismatch");
    expect(code(() => verifyRecoverySignature(challenge({ passkeyPublicKey: `p256:${"4".repeat(87)}` }), good, { domain: DOMAIN, now: NOW }))).toBe("signer_mismatch");
    expect(code(() => verifyRecoverySignature(challenge({ purpose: "enroll" }), good, { domain: DOMAIN, now: NOW }))).toBe("signer_mismatch");
    expect(code(() => verifyRecoverySignature(challenge({ domain: "evil.example" }), good, { domain: DOMAIN, now: NOW }))).toBe("invalid_challenge");
    expect(code(() => verifyRecoverySignature(c, good, { domain: DOMAIN, now: c.expiresAt }))).toBe("challenge_expired");
    expect(code(() => verifyRecoverySignature(c, good, { domain: DOMAIN, now: NOW - 1 }))).toBe("challenge_expired");
    expect(code(() => verifyRecoverySignature(c, `0x${"00".repeat(65)}`, { domain: DOMAIN, now: NOW }))).toBe("invalid_signature");
  });

  test("rejects invalid challenge inputs", () => {
    expect(() => buildRecoveryMessage(challenge({ nonce: "short" }))).toThrow(RecoveryWalletError);
    expect(() => buildRecoveryMessage(challenge({ expiresAt: NOW + 60 * 60 * 1000 }))).toThrow(RecoveryWalletError);
    expect(() => buildRecoveryMessage(challenge({ accountId: "alice.near" }))).toThrow(RecoveryWalletError);
  });
});
