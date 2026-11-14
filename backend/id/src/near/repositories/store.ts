import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import type { State, Challenge } from "../../../../../packages/wallet-contracts/src/domain/state";
export type { State, Account, Challenge, BackupPasskey, LiveTrade, Deposit, Withdrawal } from "../../../../../packages/wallet-contracts/src/domain/state";
import { createStorageRequestContext, type StorageRequestContext } from "./request-budget";
import { StorageUnavailableError } from "./storage-error";
import { getDeploymentConfig } from "../../deployment/config";
import { resolve } from "node:path";
import { createHash } from "node:crypto";


export function emptyState(): State {
  return { accounts: {}, sessions: {}, challenges: {}, requests: [] };
}
export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
/** Callbacks must be synchronous and must not perform external side effects. */
export interface StateStore {
  readonly kind?: "d1";
  scoped?(scope: RecordScope): StateStore;
  /**
   * Saves a challenge in one atomic command, replacing `previousId`. Given `bind`, the same command
   * names the new ceremony on that session and stores its hosted-flow challenge, provided the
   * session still exists. Resolves what of `bind` it stored.
   */
  saveChallenge?(id: string, challenge: Challenge, previousId: string | undefined, now: number, bind?: CeremonyBind): Promise<{ session: boolean; flow: boolean }>;
  /**
   * Names `ceremony` on the session and, given `flow`, stores that hosted-flow challenge, provided
   * the session and the ceremony's own challenge (`ceremonyId`) both still exist. One atomic command, decided
   * against current state rather than a snapshot. Resolves what it stored.
   */
  bindCeremony?(sessionId: string, ceremony: string, flow?: { id: string; challenge: Challenge; ceremonyId: string }): Promise<{ session: boolean; flow: boolean }>;
  /** One snapshot kept for several reads of a request: see `heldSnapshot`. */
  hold?(): Promise<SnapshotReader>;
  read<T>(fn: (state: State) => T): T | Promise<T>;
  transaction<T>(fn: (state: State) => T): T | Promise<T>;
}
export interface RecordScope { session?: string; challenges?: string[]; rateLimit?: boolean }
/** The session to name a new ceremony on, and the hosted-flow challenge to store with it. */
export interface CeremonyBind { sessionId: string; ceremony: string; flow?: { id: string; challenge: Challenge } }
export function scopedStore(store: StateStore, scope: RecordScope): StateStore { return store.scoped?.(scope) ?? store; }
/** Reads answered from one snapshot, which ages: only for what a later fresh read or transaction decides again. */
export type SnapshotReader = Pick<StateStore, "read">;
/** A snapshot of `store` to read from more than once; a store that cannot keep one reads afresh each time. */
export async function heldSnapshot(store: StateStore): Promise<SnapshotReader> { return store.hold ? store.hold() : store; }

// Lazy selection keeps builds credential-free and excludes SQLite initialization on Vercel.
export async function getStore(context: StorageRequestContext = createStorageRequestContext()): Promise<StateStore> {
  const deployment = getDeploymentConfig();
  const backend = process.env.TERMINAL_STORAGE || (deployment.hosted ? "postgres" : "sqlite");
  if (backend === "d1") {
    try {
      const [{ loadIdDatabase }, { D1Store }] = await Promise.all([import("../../cloudflare/bindings"), import("./d1-store")]);
      return new D1Store(await loadIdDatabase(), deployment.origin, context);
    } catch { throw new StorageUnavailableError(); }
  }
  if (!["sqlite", "postgres"].includes(backend)) throw new AppError(ErrorCode.TERMINALSTORAGEMustBeSqliteOrPostgres);
  if (deployment.hosted && backend !== "postgres") throw new AppError(ErrorCode.HostedStorageMustUsePostgres);
  if (backend === "postgres") {
    if (!process.env.DATABASE_URL) throw new AppError(ErrorCode.DATABASEURLIsRequiredForHostedStorage);
    const { PostgresStore } = await import("./postgres-store");
    return new PostgresStore(process.env.DATABASE_URL, deployment.origin);
  }
  const globalStore = globalThis as unknown as { nearStore?: StateStore };
  if (!globalStore.nearStore) {
    const { Store } = await import("./sqlite-store");
    globalStore.nearStore = new Store(resolve(/* turbopackIgnore: true */ process.env.NEAR_LOCAL_DB || "data/dya-id.sqlite"), deployment.origin);
  }
  return globalStore.nearStore;
}
export function accountFor(
  state: State,
  token: string | undefined,
  now = Date.now(),
) {
  if (!token) return undefined;
  const session = state.sessions[hash(token)];
  const account = session && session.expires > now ? state.accounts[session.accountId] : undefined;
  return account?.kind === "passkey" ? account : undefined;
}
export async function consumeChallenge(
  store: StateStore,
  token: string,
  purpose: Challenge["purpose"],
  now?: number,
) {
  const challenge = await store.transaction((s) => {
    const c = s.challenges[hash(token)];
    delete s.challenges[hash(token)];
    return c;
  });
  if (!challenge || challenge.purpose !== purpose || challenge.expires <= (now ?? Date.now()))
    throw new AppError(ErrorCode.ChallengeExpiredOrAlreadyUsedPleaseTryAgain);
  return challenge;
}
