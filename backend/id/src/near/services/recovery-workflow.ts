import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { runProviderRecovery } from "./provider-recovery-workflow";
import { randomBytes } from "node:crypto";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyRegistrationResponse, type AuthenticatorTransport, type AuthenticationResponseJSON, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { intentsIdentity } from "../auth/intents";
import { verifyAssertion } from "../auth/passkeys";
import { buildRecoveryMessage, normalizeEvmAddress, verifyRecoverySignature, type RecoveryChallenge } from "../auth/recovery-wallet";
import { accountFor, consumeChallenge, hash, type Account, type Challenge, type State } from "../repositories/store";
import { CEREMONY, SESSION, SESSION_AGE, cookieOptions, response, saveChallenge, setCookie, token, requireAccount, type WorkflowContext } from "./workflow-context";
import { localRecoveryEnabled } from "./recovery-mode";

const TTL = 300000;
function eligible(a: Account | undefined): asserts a is Account & { localRecovery: NonNullable<Account["localRecovery"]>; publicKey: string; credentialId: string } {
  if (!a?.localRecovery || !a.publicKey || !a.credentialId) throw new AppError(ErrorCode.RecoveryIsAvailableOnlyForFreshLocalRecovery);
}
function current(s: State, c: Challenge) {
  const a = s.accounts[c.accountId ?? ""];
  eligible(a);
  if (!c.recovery || c.expires <= Date.now() || a.localRecovery.revision !== c.recovery.revision || a.credentialId !== c.recovery.credentialId || a.publicKey !== c.recovery.publicKey) throw new AppError(ErrorCode.RecoveryRequestChangedOrExpired);
  return a;
}
function chainId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new AppError(ErrorCode.InvalidWalletChainID);
  return value;
}
function metadata(a: Account, address: `0x${string}`, chain: number): NonNullable<Challenge["recovery"]> {
  eligible(a);
  return { address, chainId: chain, revision: a.localRecovery.revision, credentialId: a.credentialId, publicKey: a.publicKey };
}
function proof(context: WorkflowContext, a: Account, data: NonNullable<Challenge["recovery"]>, purpose: "enroll" | "recover", publicKey: string): RecoveryChallenge {
  eligible(a);
  const now = Date.now();
  return { purpose, domain: new URL(context.deployment.origin).host, chainId: data.chainId, recoveryAddress: data.address, accountId: a.localRecovery.originalIdentity.accountId, passkeyPublicKey: intentsIdentity(publicKey).publicKey, nonce: randomBytes(32).toString("hex"), issuedAt: now, expiresAt: now + TTL };
}
async function issue(context: WorkflowContext, challenge: Challenge, result: unknown) {
  const raw = await saveChallenge(context.store, challenge, context.ceremony);
  const res = response(result);
  setCookie(res, CEREMONY, raw, { ...cookieOptions(), maxAge: 300 });
  return res;
}
function signature(body: Record<string, unknown>) {
  if (typeof body.signature !== "string") throw new AppError(ErrorCode.WalletSignatureRequired);
  return body.signature;
}

/** Complete local orchestration with real proofs. No provider/on-chain readiness is implied. */
export async function runRecovery(context: WorkflowContext) {
  const { route, body, store, session, ceremony, deployment, url } = context;
  if (!route.startsWith("recovery/")) return null;
  if (route.startsWith("recovery/provider/")) return runProviderRecovery(context);
  if (!localRecoveryEnabled() || url.origin !== deployment.origin) throw new AppError(ErrorCode.RecoveryUnavailable);
  if (route === "recovery/authorize/options") {
    const a = await requireAccount(store, session, true); eligible(a);
    if (a.recoveryWallet) throw new AppError(ErrorCode.ARecoveryWalletIsAlreadyEnrolled);
    const data = metadata(a, normalizeEvmAddress(body.address), chainId(body.chainId));
    const options = await generateAuthenticationOptions({ rpID: deployment.rpId, userVerification: "required", allowCredentials: [{ id: a.credentialId, transports: a.transports }] });
    return issue(context, { purpose: "recovery-authorize", value: options.challenge, accountId: a.id, recovery: data, expires: Date.now() + TTL }, options);
  }
  if (route === "recovery/authorize/verify") {
    const c = await consumeChallenge(store, ceremony ?? "", "recovery-authorize");
    const a = await requireAccount(store, session, true); eligible(a);
    if (c.accountId !== a.id) throw new AppError(ErrorCode.RecoveryRequestBelongsToAnotherAccount);
    const counter = await verifyAssertion(a, body as unknown as AuthenticationResponseJSON, c.value);
    await store.transaction(s => {
      const latest = current(s, c);
      if (accountFor(s, session)?.id !== a.id || latest.counter !== a.counter || latest.recoveryWallet) throw new AppError(ErrorCode.AccountChangedStartAgain);
      latest.counter = counter;
    });
    const p = proof(context, a, c.recovery!, "enroll", a.publicKey);
    return issue(context, { ...c, purpose: "recovery-enroll", value: p.nonce, expires: p.expiresAt, recovery: { ...c.recovery!, proof: p } }, { message: buildRecoveryMessage(p), expiresAt: p.expiresAt });
  }
  if (route === "recovery/enroll") {
    const c = await consumeChallenge(store, ceremony ?? "", "recovery-enroll");
    if (!c.recovery?.proof) throw new AppError(ErrorCode.RecoveryApprovalMissing);
    verifyRecoverySignature(c.recovery.proof, signature(body), { domain: new URL(deployment.origin).host });
    await store.transaction(s => {
      const a = current(s, c);
      if (accountFor(s, session)?.id !== a.id || a.recoveryWallet) throw new AppError(ErrorCode.AccountChangedStartAgain);
      a.recoveryWallet = { address: c.recovery!.address, chainId: c.recovery!.chainId, enrolledAt: Date.now(), status: "local_test" };
      a.localRecovery.revision++;
    });
    const res = response({ ok: true, status: "local_test", recoveryId: c.accountId });
    setCookie(res, CEREMONY, "", { ...cookieOptions(), maxAge: 0 });
    return res;
  }
  if (route === "recovery/register/options") {
    if (await store.read(s => accountFor(s, session))) throw new AppError(ErrorCode.SignOutBeforeTestingRecovery);
    const address = normalizeEvmAddress(body.address);
    if (typeof body.recoveryId !== "string" || body.recoveryId.length > 128) throw new AppError(ErrorCode.RecoveryIDRequired);
    const a = await store.read(s => s.accounts[body.recoveryId as string]);
    if (!a?.localRecovery || a.recoveryWallet?.address !== address) throw new AppError(ErrorCode.NoMatchingLocalRecoveryEnrollment);
    eligible(a);
    const data = metadata(a, address, chainId(body.chainId));
    const options = await generateRegistrationOptions({ rpName: "DYA ID", rpID: deployment.rpId, userID: new TextEncoder().encode(a.id), userName: `recovered-${a.id.slice(0, 8)}`, supportedAlgorithmIDs: [-7], attestationType: "none", authenticatorSelection: { residentKey: "required", userVerification: "required" }, excludeCredentials: [{ id: a.credentialId, transports: a.transports }, ...(a.backup ? [{ id: a.backup.id, transports: a.backup.transports }] : [])] });
    return issue(context, { purpose: "recovery-register", value: options.challenge, accountId: a.id, recovery: data, expires: Date.now() + TTL }, options);
  }
  if (route === "recovery/register/verify") {
    const c = await consumeChallenge(store, ceremony ?? "", "recovery-register");
    const a = await store.read(s => current(s, c));
    const result = await verifyRegistrationResponse({ response: body as unknown as RegistrationResponseJSON, expectedChallenge: c.value, expectedOrigin: deployment.origin, expectedRPID: deployment.rpId, requireUserVerification: true, supportedAlgorithmIDs: [-7] });
    if (!result.verified || !result.registrationInfo) throw new AppError(ErrorCode.ReplacementPasskeyVerificationFailed);
    const credential = result.registrationInfo.credential;
    const publicKey = Buffer.from(credential.publicKey).toString("base64url");
    const p = proof(context, a, c.recovery!, "recover", publicKey);
    return issue(context, { ...c, purpose: "recovery-complete", value: p.nonce, expires: p.expiresAt, recovery: { ...c.recovery!, proof: p, pendingCredential: { id: credential.id, publicKey, counter: credential.counter, transports: credential.transports?.filter((t): t is AuthenticatorTransport => ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"].includes(t)) } } }, { message: buildRecoveryMessage(p), expiresAt: p.expiresAt });
  }
  if (route === "recovery/complete") {
    const c = await consumeChallenge(store, ceremony ?? "", "recovery-complete");
    const data = c.recovery;
    if (!data?.proof || !data.pendingCredential) throw new AppError(ErrorCode.ReplacementPasskeyMissing);
    verifyRecoverySignature(data.proof, signature(body), { domain: new URL(deployment.origin).host });
    const raw = token();
    await store.transaction(s => {
      const a = current(s, c);
      if (a.recoveryWallet?.address !== data.address || data.proof!.passkeyPublicKey !== intentsIdentity(data.pendingCredential!.publicKey).publicKey) throw new AppError(ErrorCode.RecoveryEnrollmentChanged);
      const credential = data.pendingCredential!;
      if (Object.values(s.accounts).some(x => x.credentialId === credential.id || x.backup?.id === credential.id)) throw new AppError(ErrorCode.ThisPasskeyIsAlreadyRegisteredForRecovery);
      // Preserve the original account and records. Never derive a replacement wallet.
      a.intentsAccountId = a.localRecovery.originalIdentity.accountId;
      a.credentialId = credential.id; a.publicKey = credential.publicKey;
      a.counter = credential.counter; a.transports = credential.transports;
      a.localRecovery.revision++;
      delete a.backup; delete a.backupEnrollmentUntil; delete a.signingCheck;
      for (const [id, entry] of Object.entries(s.sessions)) if (entry.accountId === a.id) delete s.sessions[id];
      for (const [id, entry] of Object.entries(s.challenges)) {
        if (entry.accountId === a.id) delete s.challenges[id];
      }
      s.sessions[hash(raw)] = { accountId: a.id, expires: Date.now() + SESSION_AGE * 1000 };
    });
    const res = response({ ok: true, status: "local_test" });
    setCookie(res, SESSION, raw, { ...cookieOptions(), maxAge: SESSION_AGE });
    setCookie(res, CEREMONY, "", { ...cookieOptions(), maxAge: 0 });
    return res;
  }
  throw new AppError(ErrorCode.UnknownRecoveryOperation);
}
