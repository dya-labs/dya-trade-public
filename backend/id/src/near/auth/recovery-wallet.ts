import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base58 } from "@scure/base";
import { keccak_256 } from "@noble/hashes/sha3.js";

/**
 * External-wallet recovery spike: EVM (ERC-191 `personal_sign`) only.
 *
 * FUND-CONTROL INVARIANT: an enrolled recovery wallet becomes a full controller of
 * the DYA wallet (Intents multi-key model). It can move all funds and manage other
 * keys. It is NOT a limited guardian, has no time delay and no recovery-only scope.
 * Every challenge built here states that in the text the user signs.
 *
 * Pure and offline: message construction, ERC-191 hashing, signature recovery and
 * address normalization. No routes, storage, RPC or on-chain key changes.
 */

export const RECOVERY_WALLET_VERSION = "1";
export const RECOVERY_WALLET_MAX_TTL_MS = 10 * 60 * 1000;
export const FUND_CONTROL_NOTICE =
  "This wallet will have FULL CONTROL of my DYA wallet, including moving all funds. It is not a limited recovery guardian.";

export type RecoveryWalletPurpose = "enroll" | "recover";
export type EvmAddress = `0x${string}`;

export interface RecoveryChallenge {
  purpose: RecoveryWalletPurpose;
  /** Origin host the challenge is bound to: the DYA ID origin's host (APP_ORIGIN). */
  domain: string;
  /** EIP-155 chain id the wallet was connected on (informational binding; signature is chain-agnostic). */
  chainId: number;
  /** External EVM wallet that signs. */
  recoveryAddress: EvmAddress;
  /** Original DYA/Intents account (0x-hex signer id) the wallet controls. */
  accountId: string;
  /** Passkey public key being enrolled-with (enroll) or the replacement to authorize (recover). */
  passkeyPublicKey: string;
  /** Single-use server nonce, 16-64 hex chars. */
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export type RecoveryWalletErrorCode =
  | "invalid_address"
  | "invalid_challenge"
  | "invalid_signature"
  | "challenge_expired"
  | "signer_mismatch";

export class RecoveryWalletError extends Error {
  constructor(readonly code: RecoveryWalletErrorCode, message: string = code) {
    super(message);
    this.name = "RecoveryWalletError";
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SECP256K1_HALF_N = secp256k1.Point.Fn.ORDER >> BigInt(1);

/** Lowercase canonical form used for storage and comparison. Rejects bad EIP-55 checksums. */
export function normalizeEvmAddress(value: unknown): EvmAddress {
  if (typeof value !== "string" || !ADDRESS.test(value))
    throw new RecoveryWalletError("invalid_address");
  const body = value.slice(2);
  const mixed = body !== body.toLowerCase() && body !== body.toUpperCase();
  if (mixed && toChecksumAddress(value) !== value)
    throw new RecoveryWalletError("invalid_address", "bad EIP-55 checksum");
  return `0x${body.toLowerCase()}`;
}

/** EIP-55 mixed-case display form. */
export function toChecksumAddress(value: string): EvmAddress {
  if (!ADDRESS.test(value)) throw new RecoveryWalletError("invalid_address");
  const lower = value.slice(2).toLowerCase();
  const hash = Buffer.from(keccak_256(Buffer.from(lower, "utf8"))).toString("hex");
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out as EvmAddress;
}

export function sameEvmAddress(a: string, b: string) {
  return normalizeEvmAddress(a) === normalizeEvmAddress(b);
}

function validateChallenge(c: RecoveryChallenge) {
  const bad = (why: string) => new RecoveryWalletError("invalid_challenge", why);
  if (c.purpose !== "enroll" && c.purpose !== "recover") throw bad("purpose");
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(c.domain)) throw bad("domain");
  if (!Number.isSafeInteger(c.chainId) || c.chainId <= 0) throw bad("chainId");
  if (!/^0x[0-9a-f]{40}$/.test(c.accountId)) throw bad("accountId");
  if (!/^[a-z0-9]+:[1-9A-HJ-NP-Za-km-z]{32,128}$/.test(c.passkeyPublicKey)) throw bad("passkeyPublicKey");
  if (!/^[0-9a-f]{16,64}$/.test(c.nonce)) throw bad("nonce");
  if (
    !Number.isSafeInteger(c.issuedAt) ||
    !Number.isSafeInteger(c.expiresAt) ||
    c.expiresAt <= c.issuedAt ||
    c.expiresAt - c.issuedAt > RECOVERY_WALLET_MAX_TTL_MS
  ) throw bad("lifetime");
  normalizeEvmAddress(c.recoveryAddress);
}

/**
 * Deterministic, human-readable text the external wallet signs with `personal_sign`.
 * Line order and wording are part of the protocol: changing them invalidates
 * outstanding challenges, so bump RECOVERY_WALLET_VERSION when editing.
 */
export function buildRecoveryMessage(c: RecoveryChallenge): string {
  validateChallenge(c);
  const action =
    c.purpose === "enroll"
      ? "Add this wallet as a recovery controller for my DYA wallet."
      : "Recover my DYA wallet and authorize the replacement passkey below.";
  return [
    `${c.domain} wants you to sign with your Ethereum account:`,
    toChecksumAddress(c.recoveryAddress),
    "",
    action,
    FUND_CONTROL_NOTICE,
    "",
    `Purpose: ${c.purpose}`,
    `DYA Account: ${c.accountId}`,
    `Passkey: ${c.passkeyPublicKey}`,
    `Chain ID: ${c.chainId}`,
    `Version: ${RECOVERY_WALLET_VERSION}`,
    `Nonce: ${c.nonce}`,
    `Issued At: ${new Date(c.issuedAt).toISOString()}`,
    `Expiration Time: ${new Date(c.expiresAt).toISOString()}`,
  ].join("\n");
}

/** ERC-191 version 0x45: keccak256("\x19Ethereum Signed Message:\n" + len + message). */
export function hashPersonalMessage(message: string | Uint8Array): Uint8Array {
  const bytes = typeof message === "string" ? Buffer.from(message, "utf8") : message;
  const prefix = Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`, "utf8");
  return keccak_256(Buffer.concat([prefix, bytes]));
}

export function addressFromPublicKey(uncompressed: Uint8Array): EvmAddress {
  if (uncompressed.length !== 65 || uncompressed[0] !== 4)
    throw new RecoveryWalletError("invalid_signature", "expected uncompressed secp256k1 key");
  return `0x${Buffer.from(keccak_256(uncompressed.slice(1)).slice(12)).toString("hex")}`;
}

/** Recovers the signer of an ERC-191 personal_sign signature (65-byte r||s||v, v in {0,1,27,28}). Rejects high-s. */
export function recoverPersonalSignAddress(message: string | Uint8Array, signature: string): EvmAddress {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new RecoveryWalletError("invalid_signature", "expected 65-byte hex signature");
  const raw = Buffer.from(signature.slice(2), "hex");
  const v = raw[64];
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1)
    throw new RecoveryWalletError("invalid_signature", "unsupported v");
  try {
    const sig = secp256k1.Signature.fromBytes(raw.subarray(0, 64), "compact");
    if (sig.s > SECP256K1_HALF_N) throw new Error("high-s");
    const point = sig.addRecoveryBit(recovery).recoverPublicKey(hashPersonalMessage(message));
    return addressFromPublicKey(point.toBytes(false));
  } catch (cause) {
    if (cause instanceof RecoveryWalletError) throw cause;
    throw new RecoveryWalletError("invalid_signature");
  }
}

/** Recover the raw controller key only after the strict ERC-191 checks above. */
export function recoverPersonalSignPublicKey(message: string, signature: string): string {
  recoverPersonalSignAddress(message, signature);
  const bytes = Buffer.from(signature.slice(2), "hex");
  const recovery = bytes[64] >= 27 ? bytes[64] - 27 : bytes[64];
  const point = secp256k1.Signature.fromBytes(bytes.subarray(0, 64), "compact").addRecoveryBit(recovery).recoverPublicKey(hashPersonalMessage(message));
  return `secp256k1:${base58.encode(point.toBytes(false).slice(1))}`;
}

export interface VerifiedRecoverySignature {
  purpose: RecoveryWalletPurpose;
  recoveryAddress: EvmAddress;
  accountId: string;
  passkeyPublicKey: string;
  nonce: string;
  /** Always true: callers must surface that this signer can move all funds. */
  fullFundControl: true;
}

/**
 * Rebuilds the message from the server-held challenge (never from client text),
 * checks domain/expiry, and requires the recovered signer to equal the expected
 * recovery wallet. Nonce single-use and account binding are the caller's job.
 */
export function verifyRecoverySignature(
  challenge: RecoveryChallenge,
  signature: string,
  { domain, now = Date.now() }: { domain: string; now?: number },
): VerifiedRecoverySignature {
  if (challenge.domain !== domain) throw new RecoveryWalletError("invalid_challenge", "domain");
  const message = buildRecoveryMessage(challenge);
  if (now < challenge.issuedAt || now >= challenge.expiresAt) throw new RecoveryWalletError("challenge_expired");
  const signer = recoverPersonalSignAddress(message, signature);
  if (signer !== normalizeEvmAddress(challenge.recoveryAddress)) throw new RecoveryWalletError("signer_mismatch");
  return {
    purpose: challenge.purpose,
    recoveryAddress: signer,
    accountId: challenge.accountId,
    passkeyPublicKey: challenge.passkeyPublicKey,
    nonce: challenge.nonce,
    fullFundControl: true,
  };
}
