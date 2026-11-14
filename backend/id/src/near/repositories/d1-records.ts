import { tradingWithdrawalState } from "../outlayer/trading-withdrawal-state";
import { sendPolicyState } from "../outlayer/send-policy-state";
import { activationOperationSchema } from "../outlayer/activation-state";
import { feedbackRecordSchema } from "../../../../../packages/wallet-contracts/src/domain/feedback";
import { tradingFeePolicySchema } from "../../../../../packages/wallet-contracts/src/domain/trading-fees";
import { validRefundInput } from "../../../../../packages/wallet-contracts/src/domain/refund-security";
import { decodeFinancialRecord, encodeFinancialRecord } from "./financial-history";
import type { D1Database, D1Result, D1PreparedStatement } from "@cloudflare/workers-types";
import { z } from "zod";
import { tokenSchema } from "../../../../../packages/wallet-contracts/src/domain/token-registry";
import { networkSchema } from "../../../../../packages/wallet-contracts/src/domain/networks";
import type { State } from "./store";
import { StorageUnavailableError } from "./storage-error";
export const D1_SCHEMA_VERSION = 2;
export const D1_ENTITY_TABLES = {
  tokens: "id_tokens",
  networks: "id_networks",
  accessRecords: "id_access_records",
  accounts: "id_accounts", sessions: "id_sessions", challenges: "id_challenges",
  liveOrders: "id_orders", liveTrades: "id_trades", deposits: "id_deposits", withdrawals: "id_withdrawals",
} as const;
export type D1Client = Pick<D1Database, "prepare" | "batch">;
/** One SQLite statement observes metadata, versions and records at the same instant.
 * Separate result rows avoid packing a whole collection into a size-limited JSON cell.
 * Only fixed schema identifiers are interpolated; record values remain bound parameters.
 */
const recordParts = Object.entries(D1_ENTITY_TABLES).map(([field, table]) => `SELECT '${field}',id,data FROM ${table}`);
const versionsPart = "SELECT '__versions',record_id,json_object('collection',collection,'id',record_id,'version',version) FROM id_versions";
const metadataPart = "SELECT '__metadata' AS collection,'1' AS id,json_object('id',id,'origin',origin,'revision',revision,'requests',requests,'schema_version',schema_version,'readiness',readiness) AS data FROM id_metadata WHERE id=1";
// D1 restricts terms per compound SELECT; nested groups stay below that limit.
const combined = (parts: string[]) => Array.from({ length: Math.ceil(parts.length / 3) }, (_, i) => i * 3).map(start => `SELECT * FROM (${parts.slice(start, start + 3).join(" UNION ALL ")})`).join(" UNION ALL ");
const snapshots = { read: combined([metadataPart, ...recordParts]), transaction: combined([metadataPart, versionsPart, ...recordParts]) };
/**
 * The snapshot statement. `versions`: with every loaded record's version, for a transaction's
 * dependency guard; a read never writes, so it needs none.
 */
export const snapshotSql = (versions: boolean) => snapshots[versions ? "transaction" : "read"];
export function decodeCombinedSnapshot(result: D1Result, origin: string) {
  if (!result.success) throw new StorageUnavailableError();
  const groups = new Map<string, Record<string, unknown>[]>([
    ["__metadata", []], ...Object.keys(D1_ENTITY_TABLES).map(field => [field, []] as [string, Record<string, unknown>[]]),
  ]);
  const versions: { collection: string; id: string; version: number }[] = [];
  for (const row of result.results) {
    const { collection, id, data } = row as { collection: string; id: string; data: string };
    if (typeof data !== "string") throw new StorageUnavailableError();
    if (collection === "__versions") versions.push(JSON.parse(data));
    else {
      const group = groups.get(collection);
      if (!group) throw new StorageUnavailableError();
      group.push(collection === "__metadata" ? JSON.parse(data) : { id, data });
    }
  }
  const results = [...groups.values()].map(results => ({ ...result, results }));
  return { ...decodeSnapshot(results, origin), versions };
}
const text = z.string().min(1);
const time = z.number().finite().nonnegative();
const object = z.object({}).passthrough();
const providerKey = z.string().regex(/^(p256|secp256k1):[1-9A-HJ-NP-Za-km-z]{32,128}$/);
const providerAddress = z.string().regex(/^0x[0-9a-f]{40}$/);
const providerOperation = z.object({
  id: text, kind: z.enum(["enroll", "recover"]), phase: z.enum(["enroll_key", "enroll_pending", "enroll_auth", "recover_add", "recover_add_pending", "recover_test", "recover_remove", "recover_remove_pending", "recover_finish", "complete", "rejected"]),
  outcome: z.enum(["submitted", "unknown", "rejected"]).optional(), sourceCredentialId: text, sourcePublicKey: text, revision: z.number().int().nonnegative(),
  controllerAddress: providerAddress, controllerKey: providerKey, chainId: z.number().int().positive(), payload: text.optional(), intentHash: text.optional(),
  pendingCredential: z.object({ id: text, publicKey: text, counter: z.number().int().nonnegative(), transports: z.array(text).optional() }).optional(),
  revokedKeys: z.array(providerKey).max(2), createdAt: time,
}).passthrough();
const providerRecovery = z.object({ revision: z.number().int().nonnegative(), controller: z.object({ address: providerAddress, publicKey: providerKey, chainId: z.number().int().positive(), verifiedAt: time, status: z.literal("ready") }).optional(), operation: providerOperation.optional() });
const setupDraftBase = { id: z.string().uuid(), controllerId: z.string().regex(/^0s[0-9a-f]{40}$/), publicKey: text, credentialId: text, createdAt: time, sealedRegistrationReceipt: text.optional(), registrationHttpStatus: z.number().int().min(100).max(599).optional(), registrationFailure: z.enum(["transport", "receipt-checkpoint", "provider-rejected", "response-validation", "credential-checkpoint"]).optional() };
const setupDraftWallet = { walletId: z.string().uuid(), walletPublicKey: z.string().regex(/^[0-9a-f]{64}$/), sealedApiKey: text };
const outlayerSetupDraft = z.discriminatedUnion("phase", [
  z.object({ ...setupDraftBase, phase: z.enum(["registering", "registration-unknown"]) }),
  z.object({ ...setupDraftBase, ...setupDraftWallet, phase: z.literal("registered") }),
  z.object({ ...setupDraftBase, ...setupDraftWallet, phase: z.literal("policy-ready"), policyKind: z.enum(["withdrawal-v1", "transfer-v2", "transfer-v3"]).optional(), encryptedPolicy: text, policyHash: z.string().regex(/^[0-9a-f]{64}$/) }),
]);
const setupPreferences={withdrawals:z.record(z.uuid(),tradingWithdrawalState).optional(),sendPolicy:sendPolicyState.optional(),lifecycle:z.discriminatedUnion('phase',[z.object({phase:z.literal('open')}).strict(),z.object({phase:z.literal('discarded'),at:time}).strict()]).optional(),paymentAsset:z.enum(['USDC','NEAR']).optional()};
const schemas = {
  tokens: tokenSchema,
  networks: networkSchema,
  accessRecords: z.union([
    feedbackRecordSchema,
    z.object({ kind: z.literal("fee-setting"), id: z.literal("trading-fees"), policy: tradingFeePolicySchema, updatedAt: time, updatedBy: text }).strict(),
    z.object({ id: text, kind: z.literal("refund-setting"), networkId: text, chainId: z.number().int().positive().safe().optional(), addressKind: z.enum(["evm", "near", "provider"]).optional(), address: z.string().refine(v => v === "" || validRefundInput(v)), revision: z.number().int().nonnegative(), updatedAt: time, updatedBy: text }).strict(),
  ]),
  accounts: z.object({ outlayerLegacySetup:z.object(setupPreferences).strict().optional(), outlayerTradingAccounts: z.record(text,z.object({id:z.string().uuid(),name:z.string().min(1).max(32),createdAt:time,...setupPreferences,draft:outlayerSetupDraft.optional(),activation:activationOperationSchema.optional(),history:z.record(text,activationOperationSchema).optional()}).strict()).optional(), outlayerActivation: activationOperationSchema.optional(), outlayerActivationHistory: z.record(text, activationOperationSchema).optional(), outlayerRecovery: z.object({ phase: z.literal("prepared"), id: text, publicKey: text, counter: z.number().int().nonnegative(), transports: z.array(text).optional(), sourceCredentialId: text, sourcePublicKey: text, verifiedAt: time, authority: z.literal("full-owner") }).strict().optional(), outlayerSetupDraft: outlayerSetupDraft.optional(), outlayerOwnerCheck: z.object({ phase: z.literal("verified"), credentialId: text, publicKey: text, controllerId: z.string().regex(/^0s[0-9a-f]{40}$/), codeHash: text, checkedAt: time }).optional(), id: text, kind: z.literal("passkey"), credentialId: text.optional(), publicKey: text.optional(), counter: z.number().int().nonnegative().optional(), providerRecovery: providerRecovery.optional(), localRecovery: z.object({ originalIdentity: z.object({ accountId: z.string().regex(/^0x[0-9a-f]{40}$/), publicKey: text }), revision: z.number().int().nonnegative() }).optional(), recoveryWallet: z.object({ address: z.string().regex(/^0x[0-9a-f]{40}$/), chainId: z.number().int().positive(), enrolledAt: time, status: z.literal("local_test") }).optional(), backup: z.object({ id: text, publicKey: text, counter: z.number().int().nonnegative(), status: z.literal("pending_onchain") }).passthrough().optional(), fundingBatches: z.record(text, object).optional(), consolidations: z.record(text, object).optional() }).passthrough(),
  sessions: z.object({ accountId: text, expires: time, clientOrigin: text.optional(), ceremony: text.optional(), marketQuoteId: text.optional(), confidential: z.object({ ciphertext: text, version: text, expires: time, refreshExpires: time, lease: z.object({ owner: text, until: time }).optional() }).passthrough().optional() }).passthrough(),
  challenges: z.object({
    outlayerSendPolicy: z.object({
      withdrawalId: z.uuid().optional(), walletId: text, requestId: z.uuid(), sessionHash: text,
      message: z.object({
        chain_id: z.literal("mainnet"), signer_id: z.string().regex(/^0s[0-9a-f]{40}$/),
        path: z.tuple([]), timestamp: z.iso.datetime(), payload: text,
      }).strict(),
    }).strict().optional(),
    outlayerPolicyExecution: z.object({
      walletId: text, requestId: z.uuid(), sessionHash: text,
      gasPriceCap: z.string().regex(/^[1-9][0-9]*$/),
      message: z.object({
        chain_id: z.literal("mainnet"), signer_id: z.string().regex(/^0s[0-9a-f]{40}$/),
        nonce: z.number().int().nonnegative().max(0xffffffff), created_at: z.iso.datetime(),
        timeout_secs: z.number().int().positive(), request: z.object({
          internal: z.tuple([]),
          external: z.tuple([z.object({
            receiver_id: z.literal("outlayer.near"),
            actions: z.tuple([z.object({
              action: z.literal("function_call"), payload: z.object({
                function_name: z.literal("store_wallet_policy"), args: text,
                deposit: z.string().regex(/^[0-9]+$/), gas: z.string().regex(/^[0-9]+$/),
              }).strict(),
            }).strict()]),
          }).strict()]),
        }).strict(),
      }).strict(),
    }).strict().optional(),
    outlayerRecovery: z.discriminatedUnion("phase", [
    z.object({ phase: z.enum(["authorize", "register"]), sourceCredentialId: text, sourcePublicKey: text, sessionHash: text }).strict(),
    z.object({ phase: z.enum(["test", "prepared"]), sourceCredentialId: text, sourcePublicKey: text, sessionHash: text, candidate: z.object({ id: text, publicKey: text, counter: z.number().int().nonnegative(), transports: z.array(text).optional() }).strict() }).strict(),
  ]).optional(), outlayerOwner: z.object({ controllerId: z.string().regex(/^0s[0-9a-f]{40}$/), codeHash: text, publicKey: text, credentialId: text, sessionHash: text }).optional(), value: text, expires: time, providerDraft: providerOperation.optional(), purpose: z.enum(["outlayer-policy-execution", "outlayer-send-policy", "outlayer-withdrawal", "outlayer-payment", "outlayer-activation-owner", "outlayer-recovery", "outlayer-owner", "provider-recovery", "recovery-authorize", "recovery-enroll", "recovery-register", "recovery-complete", "hosted-flow", "funding-conversion", "confidential-auth", "consolidation", "register", "login", "order", "intents", "market-trade", "market-quote", "withdraw", "backup-authorize", "backup-register", "backup-test"]), accountId: text.optional(), userId: text.optional(), hostedFlow: z.object({kind: z.enum(["connect", "approval"]), clientOrigin: text, callback: text, verifierHash: text, status: z.enum(["pending", "running", "complete"])}).passthrough().optional() }).passthrough(),
  liveOrders: z.object({ id: text, ownerId: text, createdAt: time, updatedAt: time, requestId: text, terms: z.string(), preview: object, state: z.enum(["creating", "created", "failed", "unknown"]) }).passthrough(),
  liveTrades: z.object({ id: text, ownerId: text, createdAt: time, updatedAt: time, state: z.enum(["signing", "submitted", "unknown", "settled", "failed"]), review: object }).passthrough(),
  deposits: z.object({ id: text, ownerId: text, createdAt: time, updatedAt: time, status: text, quote: object }).passthrough(),
  withdrawals: z.object({ id: text, ownerId: text, createdAt: time, updatedAt: time, state: z.enum(["signing", "submitted", "unknown", "settled", "failed"]), review: object }).passthrough(),
};
export function validateRecord(field: keyof typeof D1_ENTITY_TABLES, id: string, data: unknown) {
  const result = schemas[field].safeParse(data);
  if (!id || !result.success || ("id" in result.data && result.data.id !== id)) throw new StorageUnavailableError();
  if (field === "accounts") {
    const account = result.data as Record<string, unknown>;
    for (const collection of ["fundingBatches", "consolidations"]) {
      const nested = account[collection] as Record<string, Record<string, unknown>> | undefined;
      for (const [key, item] of Object.entries(nested ?? {})) {
        if (item.id !== key) throw new StorageUnavailableError();
      }
    }
  }
  // Retain the original object, including optional/nested provider recovery fields.
  return data;
}
const metadataSchema = z.object({ id: z.literal(1), origin: text, revision: z.number().int().nonnegative().safe(), requests: text, schema_version: z.literal(D1_SCHEMA_VERSION), readiness: z.literal("ready") });
export function decodeSnapshot(results: D1Result[], origin: string): { state: State; revision: number } {
  try {
    if (results.length !== Object.keys(D1_ENTITY_TABLES).length + 1 || results.some(r => !r.success)) throw new StorageUnavailableError();
    const rows = results[0].results;
    if (rows.length !== 1) throw new StorageUnavailableError();
    const meta = metadataSchema.parse(rows[0]);
    if (meta.origin !== origin) throw new StorageUnavailableError();
    const requests = z.array(time).parse(JSON.parse(meta.requests));
    const state = { requests } as State;
    Object.entries(D1_ENTITY_TABLES).forEach(([field], i) => {
      const entries = results[i + 1].results.map(row => {
        const r = row as { id: string; data: string };
        if (typeof r.id !== "string" || typeof r.data !== "string") throw new StorageUnavailableError();
        return [r.id, validateRecord(field as keyof typeof D1_ENTITY_TABLES, r.id, decodeFinancialRecord(field, r.id, JSON.parse(r.data), origin))];
      });
      Object.defineProperty(state, field, { value: Object.fromEntries(entries), enumerable: true, writable: true });
    });
    return { state, revision: meta.revision };
  } catch { throw new StorageUnavailableError(); }
}
/** Bound JSON batches stay below D1's value-size limit. Large individual records
 * keep their original direct binding rather than gaining JSON-envelope overhead.
 */
function* jsonChunks<T>(items: T[]) {
  let chunk: T[] = [], bytes = 2;
  for (const item of items) {
    const size = new TextEncoder().encode(JSON.stringify(item)).byteLength + 1;
    if (chunk.length && bytes + size > 1_000_000) { yield chunk; chunk = []; bytes = 2; }
    chunk.push(item); bytes += size;
    if (size > 1_000_000) { yield chunk; chunk = []; bytes = 2; }
  }
  if (chunk.length) yield chunk;
}
export function changedRecords(db: D1Client, before: State, after: State, origin: string): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const [field, table] of Object.entries(D1_ENTITY_TABLES)) {
    const key = field as keyof typeof D1_ENTITY_TABLES;
    const previous = before[key] ?? {}, current = after[key] ?? {};
    const removed = Object.keys(previous).filter(id => !Object.hasOwn(current, id));
    for (const chunk of jsonChunks(removed)) statements.push(chunk.length === 1
      ? db.prepare(`DELETE FROM ${table} WHERE id=?`).bind(chunk[0])
      : db.prepare(`DELETE FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(chunk)));
    const updated: { id: string; data: string }[] = [];
    for (const [id, value] of Object.entries(current)) {
      validateRecord(key, id, value);
      const plain = JSON.stringify(value);
      if (!Object.hasOwn(previous, id) || plain !== JSON.stringify(previous[id as keyof typeof previous])) updated.push({ id, data: JSON.stringify(encodeFinancialRecord(field, id, value, origin)) });
    }
    for (const chunk of jsonChunks(updated)) statements.push(chunk.length === 1
      ? db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).bind(chunk[0].id, chunk[0].data)
      : db.prepare(`INSERT INTO ${table}(id,data) SELECT json_extract(value,'$.id'),json_extract(value,'$.data') FROM json_each(?) WHERE true ON CONFLICT(id) DO UPDATE SET data=excluded.data`).bind(JSON.stringify(chunk)));
  }
  if (!z.array(time).safeParse(after.requests).success) throw new StorageUnavailableError();
  return statements;
}
