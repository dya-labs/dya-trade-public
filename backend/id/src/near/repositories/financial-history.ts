import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { StorageUnavailableError } from "./storage-error";

export type FinancialCollection = "accounts" | "challenges" | "liveOrders" | "liveTrades" | "deposits" | "withdrawals";
const envelopeKey = "__financial";
const routing = {
  accounts: null,
  challenges: ["value", "purpose", "expires", "accountId", "userId"],
  liveOrders: ["id", "ownerId", "createdAt", "updatedAt", "state"],
  liveTrades: ["id", "ownerId", "createdAt", "updatedAt", "state"],
  deposits: ["id", "ownerId", "createdAt", "updatedAt", "status"],
  withdrawals: ["id", "ownerId", "createdAt", "updatedAt", "state"],
} as const;
const nestedFinancial = new Set(["fundingBatches", "consolidations", "outlayerActivation", "outlayerActivationHistory", "outlayerTradingAccounts", "outlayerLegacySetup"]);
type RecordData = Record<string, unknown>;
type Envelope = { v: 1; kid: string; nonce: string; ciphertext: string; tag: string };
const object = (value: unknown): value is RecordData => !!value && typeof value === "object" && !Array.isArray(value);
const fail = (): never => { throw new StorageUnavailableError(); };
export function isFinancialCollection(field: string): field is FinancialCollection { return Object.hasOwn(routing, field); }
function privateKey(field: FinancialCollection, key: string) {
  return field === "accounts" ? nestedFinancial.has(key) : !(routing[field] as readonly string[]).includes(key);
}
function split(field: FinancialCollection, value: RecordData) {
  const clear: RecordData = {}, secret: RecordData = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === envelopeKey) continue;
    Object.defineProperty(privateKey(field, key) ? secret : clear, key, { value: item, enumerable: true, writable: true, configurable: true });
  }
  return { clear, secret };
}
function configuration() {
  try {
    const active = process.env.FINANCIAL_HISTORY_ACTIVE_KEY_ID;
    const keys: unknown = JSON.parse(process.env.FINANCIAL_HISTORY_KEYS || "null");
    if (!active || !/^[a-zA-Z0-9_-]{1,64}$/.test(active) || !object(keys) || !Object.hasOwn(keys, active) || Object.keys(keys).length > 8) return fail();
    for (const [id, key] of Object.entries(keys)) if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof key !== "string" || !/^[a-fA-F0-9]{64}$/.test(key)) return fail();
    return { active, keys: keys as Record<string, string> };
  } catch { return fail(); }
}
function aad(origin: string, field: FinancialCollection, id: string, clear: RecordData, kid: string) {
  // Authenticate routing metadata as well as account, record, collection and deployment.
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
  const canonical = sort(clear);
  return Buffer.from(JSON.stringify(["dya-financial-history", 1, kid, origin, field, id, canonical]));
}
function base64(value: unknown, size?: number) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return fail();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || (size !== undefined && bytes.length !== size)) return fail();
  return bytes;
}

/** Plain domain records in memory; authenticated encrypted payloads at persistence only. */
export function encodeFinancialRecord(field: string, id: string, value: unknown, origin: string): unknown {
  if (!isFinancialCollection(field)) return value;
  if (!object(value) || Object.hasOwn(value, envelopeKey)) return fail();
  const { clear, secret } = split(field, value);
  if (!Object.keys(secret).length) return value;
  const config = configuration();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(config.keys[config.active], "hex"), nonce);
  cipher.setAAD(aad(origin, field, id, clear, config.active));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secret), "utf8"), cipher.final()]);
  const envelope: Envelope = { v: 1, kid: config.active, nonce: nonce.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
  return { ...clear, [envelopeKey]: envelope };
}
export function decodeFinancialRecord(field: string, id: string, value: unknown, origin: string, allowPlaintext = process.env.FINANCIAL_HISTORY_ALLOW_PLAINTEXT_MIGRATION === "1"): unknown {
  if (!isFinancialCollection(field)) return value;
  try {
    if (!object(value)) return fail();
    const { clear, secret } = split(field, value);
    if (!Object.hasOwn(value, envelopeKey)) {
      if (Object.keys(secret).length && !allowPlaintext) return fail();
      return value;
    }
    if (Object.keys(secret).length) return fail(); // Reject mixed/plaintext payload injection.
    const envelope = value[envelopeKey];
    if (!object(envelope) || envelope.v !== 1 || typeof envelope.kid !== "string" || Object.keys(envelope).sort().join() !== "ciphertext,kid,nonce,tag,v") return fail();
    const config = configuration();
    if (!Object.hasOwn(config.keys, envelope.kid)) return fail();
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(config.keys[envelope.kid], "hex"), base64(envelope.nonce, 12));
    decipher.setAAD(aad(origin, field, id, clear, envelope.kid));
    decipher.setAuthTag(base64(envelope.tag, 16));
    const payload: unknown = JSON.parse(Buffer.concat([decipher.update(base64(envelope.ciphertext)), decipher.final()]).toString("utf8"));
    if (!object(payload) || !Object.keys(payload).length || Object.keys(payload).some(key => key === envelopeKey || !privateKey(field, key))) return fail();
    return { ...clear, ...payload };
  } catch { return fail(); }
}
