import { tradingAccountsView } from "../outlayer/accounts";
import { assertRecoverySigningAvailable, LocalRecoveryRestricted, localRecoveryEnabled, providerRecoveryEnabled } from "./recovery-mode";

import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";

import { getDeploymentConfig } from "../../deployment/config";

import { readBalances } from "../providers/live";

import { accountIdentity, simulateProbe } from "../auth/intents";
import { randomBytes } from "node:crypto";

import { accountFor, hash, type Challenge, type SnapshotReader, type StateStore } from "../repositories/store";

import type { DeploymentConfig } from "../../deployment/config";
import type { Account } from "../../../../../packages/wallet-contracts/src/domain/state";
import type { Snapshot } from "../../../../../packages/wallet-contracts/src/http/schemas/account";
export interface WorkflowContext {
  route: string; body: Record<string, unknown>; store: StateStore;
  deployment: DeploymentConfig; url: URL; session: string | undefined; ceremony: string | undefined;
  simulator: typeof simulateProbe; balanceReader: typeof readBalances;
  /** The snapshot the service read this session's grant from, when the request came through it. */
  held?: SnapshotReader;
  /** The service's binder for a ceremony this request prepares: see `saveChallenge`. */
  bind?: CeremonyBinder;
}
/**
 * A new ceremony's place on the service's grant: the grant's session and, when the client asked
 * for one, the hosted approval flow to store with the challenge. `stored` hears what was written.
 */
export interface CeremonyBinding { sessionId: string; flow?: { id: string; challenge: Challenge }; stored(result: { session: boolean; flow: boolean }): void }
export type CeremonyBinder = (ceremony: string, challenge: Challenge) => CeremonyBinding;
/** What the service hands a wallet request whose session it has already admitted. */
export interface ServiceAdmission { account: Account | undefined; held?: SnapshotReader; bind?: CeremonyBinder }
export interface AccountWorkflowContext extends WorkflowContext { account: Account }
export const SESSION = "near_session";
export const CEREMONY = "near_challenge";
export const SESSION_AGE = 12 * 60 * 60;
export function cookieOptions() {
  return { httpOnly: true, sameSite: "strict" as const,
    secure: getDeploymentConfig().secure, path: "/" };
}
export function token() {
  return randomBytes(32).toString("base64url");
}
export interface WorkflowResult {
  headers?: Record<string, string>;
  body: unknown;
  status: number;
  cookies: { name: string; value: string; options: ReturnType<typeof cookieOptions> & { maxAge: number } }[];
  /** The challenge saved for this result's ceremony cookie. Never part of the response. */
  challenge?: Challenge;
}
/** The challenge saved for a wallet response's ceremony, for an in-process caller of the wallet API. */
export const preparedChallenges = new WeakMap<Response, Challenge>();
export function response<T>(body: T, status = 200): WorkflowResult & { body: T } {
  return { body, status, cookies: [] };
}
export function setCookie(result: WorkflowResult, name: string, value: string, options: ReturnType<typeof cookieOptions> & { maxAge: number }) {
  result.cookies.push({ name, value, options });
}
export async function requireAccount(store: StateStore, session: string | undefined, allowLocalRecovery = false) {
  return admitAccount(await store.read((s) => accountFor(s, session)), allowLocalRecovery);
}
/** `requireAccount`'s checks on an account the caller already read from its snapshot. */
export function admitAccount(a: Account | undefined, allowLocalRecovery = false) {
  if (!a) throw new AppError(ErrorCode.SignInWithAPasskeyFirst);
  if (a.localRecovery && !allowLocalRecovery) throw new LocalRecoveryRestricted();
  assertRecoverySigningAvailable(a);
  return a;
}
/** The client-safe session view `state` returns; writes that change the session return it too. */
export function sessionSnapshot(a: Account | undefined, outlayerEnabled: boolean): Snapshot {
  const trading=a&&outlayerEnabled?tradingAccountsView(a):{wallets:[],setups:[]};
  const tradingWallet=trading.wallets[0];
  return { account: a ? { ...(tradingWallet?{tradingWallet}:{}), tradingWallets:trading.wallets,tradingSetups:trading.setups, id: a.id, kind: a.kind, ...(a.name ? { name: a.name } : {}),
    localRecovery: !!a.localRecovery,
    providerRecovery: a.providerRecovery ? { controller: a.providerRecovery.controller ? { address: a.providerRecovery.controller.address, verifiedAt: a.providerRecovery.controller.verifiedAt, status: "ready" } : null, phase: a.providerRecovery.operation?.phase } : null,
    recoveryWallet: a.recoveryWallet ?? null,
    intentsIdentity: a.localRecovery?.originalIdentity ?? (a.kind === "passkey" && a.publicKey ? accountIdentity(a) : null),
    backupEnrollmentUntil: (a.backupEnrollmentUntil ?? 0) > Date.now() ? a.backupEnrollmentUntil : undefined,
    backup: a.backup ? { status: a.backup.status, testedAt: a.backup.testedAt } : null,
    signingCheck: a.signingCheck ?? null,
  } : null, recoveryMode: providerRecoveryEnabled() ? "provider" : localRecoveryEnabled() ? "local_test" : "unavailable", passkeyOrigin: getDeploymentConfig().origin };
}
export async function newSession(
  store: StateStore,
  accountId: string,
  previous: string | undefined,
  expectedCredentialId?: string,
) {
  const raw = token();
  // The snapshot comes from the committed transaction, so it reflects the new session.
  const session = await store.transaction((s) => {
    if (s.accounts[accountId]) assertRecoverySigningAvailable(s.accounts[accountId]);
    if (expectedCredentialId && s.accounts[accountId]?.credentialId !== expectedCredentialId) throw new AppError(ErrorCode.PasskeyChanged);
    if (previous) delete s.sessions[hash(previous)];
    s.sessions[hash(raw)] = {
      accountId,
      expires: Date.now() + SESSION_AGE * 1000,
    };
    return sessionSnapshot(s.accounts[accountId], true);
  });
  const res = response({ ok: true as const, session });
  setCookie(res, SESSION, raw, { ...cookieOptions(), maxAge: SESSION_AGE });
  setCookie(res, CEREMONY, "", { ...cookieOptions(), maxAge: 0 });
  return res;
}
/** `bind`: the service's binder. The write that saves the challenge then also binds its ceremony. */
export async function saveChallenge(
  store: StateStore,
  challenge: Challenge,
  previous: string | undefined,
  bind?: CeremonyBinder,
) {
  const raw = token(), binding = bind?.(raw, challenge);
  if (store.saveChallenge) {
    const stored = await store.saveChallenge(hash(raw), challenge, previous ? hash(previous) : undefined, Date.now(), binding && { sessionId: binding.sessionId, ceremony: raw, flow: binding.flow });
    binding?.stored(stored);
    return raw;
  }
  const stored = await store.transaction((s) => {
    const now = Date.now();
    for (const [k, c] of Object.entries(s.challenges))
      if (c.expires <= now) delete s.challenges[k];
    for (const [k, session] of Object.entries(s.sessions))
      if (session.expires <= now) delete s.sessions[k];
    if (previous) delete s.challenges[hash(previous)];
    s.requests = s.requests.filter((t) => t > now - 60000);
    if (s.requests.length >= 60)
      throw new AppError(ErrorCode.TooManyAuthenticationRequestsTryAgainInAMinute);
    s.requests.push(now);
    s.challenges[hash(raw)] = structuredClone(challenge);
    if (!binding) return { session: false, flow: false };
    const session = s.sessions[binding.sessionId];
    if (!session) return { session: false, flow: false };
    session.ceremony = raw;
    if (binding.flow) s.challenges[binding.flow.id] = structuredClone(binding.flow.challenge);
    return { session: true, flow: !!binding.flow };
  });
  binding?.stored(stored);
  return raw;
}
