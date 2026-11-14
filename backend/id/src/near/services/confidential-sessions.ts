import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { StorageUnavailableError, ConfidentialRefreshBusyError } from "../repositories/storage-error";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { accountFor, hash, type SnapshotReader, type StateStore } from "../repositories/store";
import { ConfidentialAccessRequired } from "../../../../../packages/wallet-contracts/src/domain/confidential-access-error";
import { authenticateConfidential, readConfidentialBalances, refreshConfidential } from "../providers/confidential";

const tokensSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1) });
export interface ConfidentialSession {
  ciphertext: string;
  version: string;
  expires: number;
  refreshExpires: number;
  lease?: { owner: string; until: number };
}
export function encryptionKey() {
  const value = process.env.CONFIDENTIAL_SESSION_KEY;
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error("Private session storage is not configured. Set CONFIDENTIAL_SESSION_KEY to a 32-byte hex key.");
  return Buffer.from(value, "hex");
}
function seal(tokens: z.infer<typeof tokensSchema>, binding: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(binding));
  return Buffer.concat([iv, cipher.update(JSON.stringify(tokens), "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64url");
}
function open(ciphertext: string, binding: string) {
  const key = encryptionKey();
  try {
    const data = Buffer.from(ciphertext, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(binding));
    decipher.setAuthTag(data.subarray(-16));
    return tokensSchema.parse(JSON.parse(Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString("utf8")));
  } catch { throw new ConfidentialAccessRequired("Private session could not be restored. Confirm your passkey again."); }
}
/** Construct an encrypted grant for an atomic recovery/account/session commit. */
export function sealedConfidentialSession(session: string, accountId: string, auth: Awaited<ReturnType<typeof authenticateConfidential>>, sessionExpires: number): ConfidentialSession {
  const ciphertext = seal({ accessToken: auth.accessToken, refreshToken: auth.refreshToken }, `${hash(session)}:${accountId}`);
  return { ciphertext, version: randomUUID(), expires: Date.now() + auth.expiresIn * 1000, refreshExpires: Math.min(sessionExpires, Date.now() + auth.refreshExpiresIn * 1000) };
}

export async function rememberConfidentialSession(store: StateStore, session: string, accountId: string, auth: Awaited<ReturnType<typeof authenticateConfidential>>) {
  const key = hash(session);
  const ciphertext = seal({ accessToken: auth.accessToken, refreshToken: auth.refreshToken }, `${key}:${accountId}`);
  await store.transaction(s => {
    if (accountFor(s, session)?.id !== accountId) throw new AppError(ErrorCode.SessionExpiredWithPeriod);
    s.sessions[key].confidential = { ciphertext, version: randomUUID(), expires: Date.now() + auth.expiresIn * 1000,
      refreshExpires: Math.min(s.sessions[key].expires, Date.now() + auth.refreshExpiresIn * 1000) };
  });
}

// Short DB transactions acquire a lease; provider calls never hold DB locks.
// The owner/version check fences out late responses after logout, reauthentication,
// or lease takeover. No process-local state is required to restore private access.
/** `held`: a snapshot the request already has. A token it shows usable needs no read; the check after the provider call still runs on fresh state. */
export async function withConfidentialSession<T>(store: StateStore, session: string | undefined, accountId: string, request: (accessToken: string) => Promise<T>, held?: SnapshotReader): Promise<T> {
  if (!session) throw new ConfidentialAccessRequired("Unlock confidential balances with your passkey first.");
  const key = hash(session), binding = `${key}:${accountId}`, owner = randomUUID();
  const deadline = Date.now() + 17000;
  const known = held && await held.read(s => {
    const auth = s.sessions[key]?.confidential;
    return accountFor(s, session)?.id === accountId && auth && auth.refreshExpires > Date.now() && auth.expires > Date.now() + 30000 ? { auth: structuredClone(auth), refresh: false } : null;
  });
  for (let attempt = 0; ; attempt++) {
    // A usable token needs no lease or mutation. Keep the final version/revocation
    // check below; only refresh and invalid-session cleanup need row locks.
    const fresh = (attempt === 0 && known) || await store.read(s => {
      const auth = s.sessions[key]?.confidential;
      if (accountFor(s, session)?.id !== accountId || !auth || auth.refreshExpires <= Date.now()) return null;
      if (auth.expires <= Date.now() + 30000) {
        if (store.kind === "d1" && auth.lease && auth.lease.until > Date.now()) throw new ConfidentialRefreshBusyError();
        return null;
      }
      return { auth: structuredClone(auth), refresh: false };
    });
    const claim = fresh ?? await store.transaction(s => {
      const row = s.sessions[key];
      const auth = row?.confidential;
      if (accountFor(s, session)?.id !== accountId || !auth || auth.refreshExpires <= Date.now()) {
        if (row) delete row.confidential;
        return null;
      }
      if (auth.expires > Date.now() + 30000) return { auth: structuredClone(auth), refresh: false };
      if (auth.lease && auth.lease.until > Date.now()) return { waiting: true } as const;
      auth.lease = { owner, until: Date.now() + 20000 };
      return { auth: structuredClone(auth), refresh: true };
    });
    if (!claim) throw new ConfidentialAccessRequired("Unlock confidential balances with your passkey first.");
    if ("waiting" in claim) {
      if (store.kind === "d1") throw new ConfidentialRefreshBusyError();
      if (Date.now() >= deadline) throw new AppError(ErrorCode.PrivateAccessIsRefreshing);
      await new Promise(resolve => setTimeout(resolve, 200));
      continue;
    }
    let auth = claim.auth;
    try {
      let tokens = open(auth.ciphertext, binding);
      if (claim.refresh) {
        const refreshed = await refreshConfidential(tokens.refreshToken);
        tokens = { ...tokens, accessToken: refreshed.accessToken };
        const next = { ...auth, ciphertext: seal(tokens, binding), expires: Date.now() + refreshed.expiresIn * 1000, version: randomUUID(), lease: undefined };
        const saved = await store.transaction(s => {
          const current = s.sessions[key]?.confidential;
          if (accountFor(s, session)?.id !== accountId || current?.version !== auth.version || current.lease?.owner !== owner || current.lease.until <= Date.now() || current.refreshExpires <= Date.now()) return false;
          s.sessions[key].confidential = next;
          return true;
        });
        if (!saved) throw new AppError(ErrorCode.PrivateSessionChanged);
        auth = next;
      }
      const providerStarted = Date.now();
      const balances = await request(tokens.accessToken);
      console.info("wallet.provider.duration", { operation: "confidential-balances", durationMs: Date.now() - providerStarted });
      if (!await store.read(s => accountFor(s, session)?.id === accountId && s.sessions[key]?.confidential?.version === auth.version && auth.refreshExpires > Date.now())) throw new ConfidentialAccessRequired();
      return balances;
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw error;
      await store.transaction(s => {
        const current = s.sessions[key]?.confidential;
        if (current?.version !== auth.version) return;
        // A former lease owner must not revoke credentials a newer worker owns.
        if (current.lease && current.lease.owner !== owner) return;
        if (error instanceof ConfidentialAccessRequired) delete s.sessions[key].confidential;
        else if (current.lease?.owner === owner) delete current.lease;
      });
      throw error;
    }
  }
}

export const confidentialSessionBalances = (store: StateStore, session: string | undefined, accountId: string, held?: SnapshotReader) => withConfidentialSession(store, session, accountId, readConfidentialBalances, held);

/** Move the just-authenticated host session into its newly approved app grant.
 * Tokens are rebound to the grant and are never shared between refresh leases. */
export function transferConfidentialSession(s: Parameters<Parameters<StateStore["transaction"]>[0]>[0], source: string, target: string) {
    const account = accountFor(s, source), destination = accountFor(s, target);
    if (!account || destination?.id !== account.id) throw new AppError(ErrorCode.WalletConnectionChanged);
    const original = s.sessions[hash(source)].confidential;
    if (!original) return;
    const tokens = open(original.ciphertext, `${hash(source)}:${account.id}`);
    s.sessions[hash(target)].confidential = { ...original, ciphertext: seal(tokens, `${hash(target)}:${account.id}`), version: randomUUID(), lease: undefined, refreshExpires: Math.min(original.refreshExpires, s.sessions[hash(target)].expires) };
    delete s.sessions[hash(source)].confidential;
}
