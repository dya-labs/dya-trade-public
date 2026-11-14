import { z } from "zod";
import { amount, rawAmount, text, timestamp } from "./common";

export const accountName = z.string().trim().min(1).max(64).regex(/^\S+$/u, "Names cannot contain spaces.").refine(value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), "Use a name without control characters.");

const transports = z.enum(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);
const credential = z.object({ id: text, type: z.literal("public-key"), transports: z.array(transports).optional() });
const verification = z.enum(["required", "preferred", "discouraged"]);
// Preserve optional WebAuthn extension fields for the browser library.
const extensions = z.looseObject({ appid: z.string().optional(), credProps: z.boolean().optional(), hmacCreateSecret: z.boolean().optional() });
export const authenticationOptions = z.object({
  challenge: text, timeout: z.number().positive().optional(), rpId: text.optional(),
  allowCredentials: z.array(credential).optional(), userVerification: verification.optional(), extensions: extensions.optional(),
});
export const registrationOptions = z.object({
  challenge: text, rp: z.object({ name: text, id: text.optional() }),
  user: z.object({ id: text, name: text, displayName: z.string() }),
  pubKeyCredParams: z.array(z.object({ type: z.literal("public-key"), alg: z.number().int() })).min(1),
  timeout: z.number().positive().optional(), excludeCredentials: z.array(credential).optional(),
  authenticatorSelection: z.object({
    authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
    residentKey: z.enum(["required", "preferred", "discouraged"]).optional(),
    requireResidentKey: z.boolean().optional(), userVerification: verification.optional(),
  }).optional(),
  attestation: z.enum(["none", "indirect", "direct", "enterprise"]).optional(),
  extensions: extensions.optional(), hints: z.array(z.enum(["security-key", "client-device", "hybrid"])).optional(),
});
export const signingCheck = z.object({
  status: z.enum(["verified", "unavailable"]), checkedAt: timestamp, accountId: text,
  blockHeight: timestamp.optional(), message: text,
});
export const snapshot = z.object({
  account: z.object({ id: text, kind: z.literal("passkey"), name: accountName.optional(),
    localRecovery: z.boolean().optional(),
    providerRecovery: z.object({ controller: z.object({ address: text, verifiedAt: timestamp, status: z.literal("ready") }).nullable(), phase: text.optional() }).nullable().optional(),
    recoveryWallet: z.object({ address: text, chainId: z.number().int().positive(), enrolledAt: timestamp, status: z.literal("local_test") }).nullable().optional(),
    intentsIdentity: z.object({ accountId: text, publicKey: text }).nullable().optional(),
    tradingWallets: z.array(z.object({id:text,name:text,controllerId:text,recoveryInstalled:z.boolean()})).optional(),
    tradingSetups: z.array(z.object({id:text,name:text})).optional(),
    tradingWallet: z.object({ id: text, controllerId: text, recoveryInstalled: z.boolean() }).optional(),
    backupEnrollmentUntil: timestamp.optional(),
    backup: z.object({ status: z.literal("pending_onchain"), testedAt: timestamp.optional() }).nullable().optional(),
    signingCheck: signingCheck.nullable().optional(),
  }).nullable(), recoveryMode: z.enum(["local_test", "provider", "unavailable"]).optional(), passkeyOrigin: z.url(),
});
export type Snapshot = z.infer<typeof snapshot>;
export const balances = z.object({ accountId: text, blockHeight: timestamp, checkedAt: timestamp,
  assets: z.array(z.object({ symbol: text, assetId: text, decimals: z.number().int().nonnegative(), raw: rawAmount, amount })),
});
