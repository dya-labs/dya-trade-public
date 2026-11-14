import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { randomBytes, randomUUID } from "node:crypto";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON, type AuthenticatorTransport } from "@simplewebauthn/server";
import type { ProviderRecoveryOperation } from "../../../../../packages/wallet-contracts/src/domain/state";
import { accountIdentity, intentsIdentity, createConfidentialOwnershipProbe, encodeAssertion, payloadChallenge } from "../auth/intents";
import { buildRecoveryMessage, normalizeEvmAddress, recoverPersonalSignAddress, recoverPersonalSignPublicKey, verifyRecoverySignature, type RecoveryChallenge } from "../auth/recovery-wallet";
import { verifyAssertion } from "../auth/passkeys";
import { recoveryProvider, recoveryIntentHash, encodeEvmIntent, validateKeyPayload, type SignedRecoveryIntent } from "../providers/recovery";
import { accountFor, hash, type Account, type Challenge, type State } from "../repositories/store";
import { encryptionKey, sealedConfidentialSession } from "./confidential-sessions";
import { providerRecoveryEnabled } from "./recovery-mode";
import { CEREMONY, SESSION, SESSION_AGE, cookieOptions, response, saveChallenge, setCookie, token, type WorkflowContext } from "./workflow-context";

function recoveryProofExpiry(payload: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new AppError(ErrorCode.RecoveryStepExpiredOrAlreadyStarted);
  }
  const expiresAt = parsed && typeof parsed === "object" && "deadline" in parsed && typeof parsed.deadline === "string"
    ? Date.parse(parsed.deadline)
    : NaN;
  if (!Number.isFinite(expiresAt)) throw new AppError(ErrorCode.RecoveryStepExpiredOrAlreadyStarted);
  return expiresAt;
}

const FIVE_MINUTES = 300000, FLOW_AGE = 86400000;
const active = (op?: ProviderRecoveryOperation) => !!op && !["complete", "rejected"].includes(op.phase);
function eligible(a: Account | undefined): asserts a is Account & { publicKey: string; credentialId: string } {
  if (!a?.publicKey || !a.credentialId || a.localRecovery) throw new AppError(ErrorCode.AccountCannotUseRecovery);
}
function bound(s: State, c: Challenge) {
  const a = s.accounts[c.accountId ?? ""]; eligible(a);
  if (!c.recovery || (a.providerRecovery?.revision ?? 0) !== c.recovery.revision || a.credentialId !== c.recovery.credentialId || a.publicKey !== c.recovery.publicKey) throw new AppError(ErrorCode.WalletChanged);
  return a;
}
function operation(a: Account, c: Challenge) {
  const stored = a.providerRecovery?.operation;
  const op = stored?.id === c.providerOperationId ? stored : !active(stored) ? c.providerDraft : undefined;
  if (!op || op.id !== c.providerOperationId || op.revision !== c.recovery?.revision) throw new AppError(ErrorCode.RecoveryOperationChanged);
  return op;
}
function changes(op: ProviderRecoveryOperation) {
  if (op.phase.startsWith("enroll")) return [{ intent: "add_public_key" as const, public_key: op.controllerKey }];
  if (op.phase === "recover_add" || op.phase === "recover_add_pending") return [{ intent: "add_public_key" as const, public_key: intentsIdentity(op.pendingCredential!.publicKey).publicKey }];
  return op.revokedKeys.map(public_key => ({ intent: "remove_public_key" as const, public_key }));
}
function walletSignature(body: Record<string, unknown>) { if (typeof body.signature !== "string") throw new AppError(ErrorCode.RecoveryWalletSignatureRequired); return body.signature; }
function metadata(a: Account, address: `0x${string}`, chainId: unknown): NonNullable<Challenge["recovery"]> {
  eligible(a);
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) throw new AppError(ErrorCode.InvalidWalletChainID);
  return { address, chainId, revision: a.providerRecovery?.revision ?? 0, credentialId: a.credentialId, publicKey: a.publicKey };
}
function ownership(context: WorkflowContext, a: Account, data: NonNullable<Challenge["recovery"]>, purpose: "enroll" | "recover", key: string): RecoveryChallenge {
  const issuedAt = Date.now();
  return { purpose, domain: new URL(context.deployment.origin).host, chainId: data.chainId, recoveryAddress: data.address, accountId: accountIdentity(a).accountId, passkeyPublicKey: intentsIdentity(key).publicKey, nonce: randomBytes(32).toString("hex"), issuedAt, expiresAt: issuedAt + FIVE_MINUTES };
}
async function issue(context: WorkflowContext, c: Challenge, result: unknown) {
  const raw = await saveChallenge(context.store, c, context.ceremony);
  const res = response(result);
  setCookie(res, CEREMONY, raw, { ...cookieOptions(), maxAge: FLOW_AGE / 1000 });
  return res;
}
async function flow(context: WorkflowContext, phase?: string) {
  const c = await context.store.read(s => s.challenges[hash(context.ceremony ?? "")]);
  if (!c || c.purpose !== "provider-recovery" || c.expires <= Date.now() || (phase && c.providerPhase !== phase)) throw new AppError(ErrorCode.RecoveryConfirmationExpiredOrAlreadyUsed);
  if (phase && c.providerProofExpires! <= Date.now()) throw new AppError(ErrorCode.RecoverySignatureRequestExpired);
  return c;
}
async function present(context: WorkflowContext, c: Challenge) {
  if (c.providerDiscovery) {
    if (!c.providerProofExpires || c.providerProofExpires <= Date.now()) throw new AppError(ErrorCode.WalletDiscoveryExpired);
    return response(c.providerPhase === "recover_discover" ? { phase: c.providerPhase, message: c.providerDiscovery.message, expiresAt: c.providerProofExpires } : { phase: "recover_select", accounts: c.providerDiscovery.accountIds?.map(id => ({ id, label: `DYA account ${id.slice(0, 8)}` })), expiresAt: c.providerProofExpires });
  }
  const a = await context.store.read(s => bound(s, c));
  if (!c.providerOperationId || c.providerPhase === "recover_resume" || c.providerPhase === "enroll_ownership") {
    if (!c.providerProofExpires || c.providerProofExpires <= Date.now()) throw new AppError(ErrorCode.RecoveryOwnershipOrRegistrationRequestExpired);
    return response({ phase: c.providerPhase, options: c.hostedOptions, message: c.recovery?.proof ? buildRecoveryMessage(c.recovery.proof) : undefined, expiresAt: c.providerProofExpires });
  }
  const op = operation(a, c);
  if (op.phase === "complete") return response({ phase: "complete", recoveryId: a.id });
  if (op.phase === "rejected") return response({ phase: "rejected", error: "Provider rejected the key change. No recovery readiness is claimed." });
  if (op.phase.endsWith("_pending")) {
    if (!op.intentHash || !await recoveryProvider.settled(op.intentHash)) return response({ phase: op.phase, pending: true, outcome: op.outcome ?? "unknown" });
    const identity = accountIdentity(a);
    const newKey = op.kind === "enroll" ? op.controllerKey : intentsIdentity(op.pendingCredential!.publicKey).publicKey;
    if (!await recoveryProvider.hasKey(identity.accountId, newKey) || (op.kind === "recover" && !await recoveryProvider.hasKey(identity.accountId, op.controllerKey))) throw new AppError(ErrorCode.FinalizedWalletAuthorityDiffersFromTheRecoveryRequest);
    if (op.phase === "recover_remove_pending") for (const oldKey of op.revokedKeys) if (await recoveryProvider.hasKey(identity.accountId, oldKey)) throw new AppError(ErrorCode.OldKeyRevocationIsNotFinalizedCheckStatusAgain);
    const next = op.phase === "enroll_pending" ? "enroll_auth" : op.phase === "recover_add_pending" ? "recover_test" : "recover_finish";
    await context.store.transaction(s => {
      const latest = bound(s, c); const current = operation(latest, c);
      if (current.phase !== op.phase) return;
      current.phase = next;
      const challenge = s.challenges[hash(context.ceremony!)];
      challenge.providerPhase = next; delete challenge.payload; delete challenge.providerProofExpires;
    });
    return present(context, await flow(context));
  }
  let payload = c.payload;
  let expiresAt: number;
  if (!payload || !c.providerProofExpires || c.providerProofExpires <= Date.now() + 10000 || c.providerPhase !== op.phase) {
    payload = ["enroll_key", "recover_add", "recover_remove"].includes(op.phase)
      ? await recoveryProvider.prepare(accountIdentity(a).accountId, changes(op))
      : createConfidentialOwnershipProbe({ accountId: accountIdentity(a).accountId, publicKey: op.phase === "enroll_auth" ? op.controllerKey : intentsIdentity(op.pendingCredential!.publicKey).publicKey }, await recoveryProvider.salt()).payload;
    const nextPayload = payload;
    expiresAt = recoveryProofExpiry(nextPayload);
    await context.store.transaction(s => {
      const latest = bound(s, c); const current = operation(latest, c);
      if (current.phase !== op.phase) throw new AppError(ErrorCode.RecoveryStepChanged);
      const challenge = s.challenges[hash(context.ceremony!)];
      challenge.providerPhase = op.phase; challenge.payload = nextPayload;
      challenge.providerProofExpires = expiresAt;
    });
  } else {
    expiresAt = recoveryProofExpiry(payload);
  }
  if (["enroll_key", "recover_test", "recover_finish"].includes(op.phase)) {
    const credential = op.phase === "enroll_key" ? a : { ...a, credentialId: op.pendingCredential!.id, publicKey: op.pendingCredential!.publicKey, counter: op.pendingCredential!.counter, transports: op.pendingCredential!.transports };
    const options = await generateAuthenticationOptions({ rpID: context.deployment.rpId, challenge: payloadChallenge(payload), userVerification: "required", allowCredentials: [{ id: credential.credentialId!, transports: credential.transports }] });
    return response({ phase: op.phase, options, expiresAt });
  }
  return response({ phase: op.phase, message: payload, expiresAt });
}
async function publish(context: WorkflowContext, c: Challenge, signed: SignedRecoveryIntent, expectedPhase: ProviderRecoveryOperation["phase"], pendingPhase: ProviderRecoveryOperation["phase"], counter?: number) {
  const a = await context.store.read(s => bound(s, c)); const op = operation(a, c);
  if (op.phase !== expectedPhase || !c.payload || signed.payload !== c.payload) throw new AppError(ErrorCode.RecoveryStepAlreadyStarted);
  validateKeyPayload(c.payload, accountIdentity(a).accountId, changes(op));
  const intentHash = recoveryIntentHash(signed);
  await context.store.transaction(s => {
    const latest = bound(s, c); const challenge = s.challenges[hash(context.ceremony!)]; const current = operation(latest, challenge ?? c);
    if (current.phase !== expectedPhase || challenge?.providerPhase !== expectedPhase || challenge.payload !== c.payload || challenge.providerProofExpires! <= Date.now()) throw new AppError(ErrorCode.RecoveryStepExpiredOrAlreadyStarted);
    if (op.kind === "enroll" && (accountFor(s, context.session)?.id !== a.id || latest.counter !== a.counter)) throw new AppError(ErrorCode.SessionChangedApproveEnrollmentAgain);
    latest.providerRecovery ??= { revision: 0 };
    latest.intentsAccountId ??= accountIdentity(latest).accountId;
    latest.providerRecovery.operation = current;
    delete challenge.providerDraft;
    if (counter !== undefined) latest.counter = counter;
    current.phase = pendingPhase; current.outcome = "unknown"; current.intentHash = intentHash; current.payload = c.payload;
    challenge.providerPhase = pendingPhase; delete challenge.payload; delete challenge.providerProofExpires;
    if (pendingPhase === "recover_add_pending") revoke(s, a.id, hash(context.ceremony!));
  });
  let outcome: "submitted" | "unknown" | "rejected" = "unknown";
  try { outcome = await recoveryProvider.publish(signed); } catch { /* Persist the claim; status checks never retransmit. */ }
  await context.store.transaction(s => {
    const current = s.accounts[a.id]?.providerRecovery?.operation;
    if (!current || current.id !== op.id || current.phase !== pendingPhase) return;
    current.outcome = outcome;
    if (outcome === "rejected") current.phase = pendingPhase === "recover_remove_pending" ? "recover_remove" : "rejected";
  });
  if (outcome === "rejected" && pendingPhase === "recover_remove_pending") {
    const result = await present(context, await flow(context));
    return { ...result, body: { ...result.body, error: "Provider rejected revocation. The previous keys remain authorized; review and sign a fresh revocation request." } };
  }
  return response({ phase: outcome === "rejected" ? "rejected" : pendingPhase, pending: outcome !== "rejected", outcome });
}
function revoke(s: State, accountId: string, keepChallenge: string) {
  for (const [id, entry] of Object.entries(s.sessions)) if (entry.accountId === accountId) delete s.sessions[id];
  for (const [id, entry] of Object.entries(s.challenges)) if (entry.accountId === accountId && id !== keepChallenge) delete s.challenges[id];
}

export async function runProviderRecovery(context: WorkflowContext) {
  const { route, body, store, session, deployment } = context;
  if (!route.startsWith("recovery/provider/")) return null;
  if (!providerRecoveryEnabled() || context.url.origin !== deployment.origin) throw new Error("Provider recovery is not configured. Configure the relay credential and encrypted session storage.");
  encryptionKey();
  const action = route.slice("recovery/provider/".length);
  if (action === "enroll/options") {
    const a = await store.read(s => accountFor(s, session)); eligible(a);
    if (a.providerRecovery?.controller) throw new AppError(ErrorCode.ARecoveryWalletIsAlreadyVerified);
    const data = metadata(a, normalizeEvmAddress(body.address), body.chainId);
    const previous = a.providerRecovery?.operation;
    if (active(previous) && (previous!.kind !== "enroll" || previous!.controllerAddress !== data.address)) throw new AppError(ErrorCode.CheckTheExistingRecoveryEnrollmentFirst);
    const p = ownership(context, a, data, "enroll", a.publicKey);
    return issue(context, { value: p.nonce, purpose: "provider-recovery", accountId: a.id, providerPhase: "enroll_ownership", providerProofExpires: p.expiresAt, expires: Date.now() + FLOW_AGE, recovery: { ...data, proof: p } }, { phase: "enroll_ownership", message: buildRecoveryMessage(p), expiresAt: p.expiresAt });
  }
  if (action === "enroll/proof") {
    const c = await flow(context, "enroll_ownership");
    const sig = walletSignature(body);
    verifyRecoverySignature(c.recovery!.proof!, sig, { domain: new URL(deployment.origin).host });
    const controllerKey = recoverPersonalSignPublicKey(buildRecoveryMessage(c.recovery!.proof!), sig);
    await store.transaction(s => {
      const a = bound(s, c);
      if (accountFor(s, session)?.id !== a.id || a.providerRecovery?.controller) throw new AppError(ErrorCode.AccountChangedStartEnrollmentAgain);
      a.intentsAccountId ??= accountIdentity(a).accountId;
      a.providerRecovery ??= { revision: 0 };
      const previous = a.providerRecovery.operation;
      if (active(previous) && (previous!.kind !== "enroll" || previous!.controllerKey !== controllerKey)) throw new AppError(ErrorCode.AnotherEnrollmentIsPending);
      const op: ProviderRecoveryOperation = active(previous) ? previous! : { id: randomUUID(), kind: "enroll", phase: "enroll_key", sourceCredentialId: a.credentialId!, sourcePublicKey: a.publicKey!, revision: a.providerRecovery.revision, controllerAddress: c.recovery!.address, controllerKey, chainId: c.recovery!.chainId, revokedKeys: [], createdAt: Date.now() };
      const latest = s.challenges[hash(context.ceremony!)];
      if (latest.providerPhase !== "enroll_ownership") throw new AppError(ErrorCode.WalletProofAlreadyUsed);
      if (!active(previous)) latest.providerDraft = op;
      latest.providerOperationId = op.id; latest.providerPhase = op.phase; delete latest.recovery!.proof;
    });
    return present(context, await flow(context));
  }
  if (action === "enroll/submit") {
    const c = await flow(context, "enroll_key"); const a = await store.read(s => bound(s, c));
    const assertion = body as unknown as AuthenticationResponseJSON;
    const counter = await verifyAssertion(a, assertion, payloadChallenge(c.payload!).toString("base64url"));
    return publish(context, c, encodeAssertion(accountIdentity(a), c.payload!, assertion), "enroll_key", "enroll_pending", counter);
  }
  if (action === "enroll/verify") {
    const c = await flow(context, "enroll_auth"); const a = await store.read(s => bound(s, c)); const op = operation(a, c);
    const signed = encodeEvmIntent(c.payload!, walletSignature(body), op.controllerAddress, op.controllerKey);
    await recoveryProvider.authenticate(signed);
    if (!await recoveryProvider.hasKey(accountIdentity(a).accountId, op.controllerKey)) throw new AppError(ErrorCode.RecoveryKeyIsNoLongerAuthorized);
    await store.transaction(s => {
      const latest = bound(s, c); const current = operation(latest, c);
      if (current.phase !== "enroll_auth") throw new AppError(ErrorCode.EnrollmentAlreadyVerified);
      latest.providerRecovery!.controller = { address: op.controllerAddress, publicKey: op.controllerKey, chainId: op.chainId, status: "ready", verifiedAt: Date.now() };
      latest.providerRecovery!.revision++; current.phase = "complete";
      delete s.challenges[hash(context.ceremony!)];
    });
    const res = response({ phase: "complete", recoveryId: a.id }); setCookie(res, CEREMONY, "", { ...cookieOptions(), maxAge: 0 }); return res;
  }
  if (action === "discover/options") {
    const address = normalizeEvmAddress(body.address);
    const chainId = body.chainId;
    if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) throw new AppError(ErrorCode.InvalidWalletChainID);
    const nonce = randomBytes(32).toString("hex"), expiresAt = Date.now() + FIVE_MINUTES;
    const message = [`${new URL(deployment.origin).host} wants you to sign with your Ethereum account:`, address, "", "Find my DYA accounts linked to this recovery wallet.", "This proof only discovers accounts. It does not authorize key changes or transfers.", `Chain ID: ${chainId}`, `Nonce: ${nonce}`, `Expiration Time: ${new Date(expiresAt).toISOString()}`].join("\n");
    return issue(context, { purpose: "provider-recovery", value: nonce, providerPhase: "recover_discover", providerProofExpires: expiresAt, expires: expiresAt, providerDiscovery: { address, chainId, message } }, { phase: "recover_discover", message, expiresAt });
  }
  if (action === "discover/proof") {
    const c = await flow(context, "recover_discover"), discovery = c.providerDiscovery!;
    const signature = walletSignature(body);
    if (recoverPersonalSignAddress(discovery.message, signature) !== discovery.address) throw new AppError(ErrorCode.RecoveryWalletSignatureDoesNotMatch);
    const publicKey = recoverPersonalSignPublicKey(discovery.message, signature);
    await store.transaction(s => {
      const current = s.challenges[hash(context.ceremony!)];
      if (current?.providerPhase !== "recover_discover" || current.value !== c.value || current.providerProofExpires! <= Date.now()) throw new AppError(ErrorCode.WalletDiscoveryProofExpiredOrAlreadyUsed);
      const accounts = Object.values(s.accounts).filter(a => !a.localRecovery && a.credentialId && a.publicKey && a.providerRecovery?.controller?.status === "ready" && a.providerRecovery.controller.address === discovery.address && a.providerRecovery.controller.publicKey === publicKey);
      current.providerDiscovery!.accountIds = accounts.map(a => a.id);
      current.providerPhase = "recover_select";
    });
    return present(context, await flow(context));
  }
  if (action === "discover/select") {
    const c = await flow(context, "recover_select"), discovery = c.providerDiscovery!;
    if (typeof body.recoveryId !== "string" || !discovery.accountIds?.includes(body.recoveryId)) throw new AppError(ErrorCode.ChooseAnAccountLinkedToThisRecoveryWallet);
    return runProviderRecovery({ ...context, route: "recovery/provider/recover/options", body: { recoveryId: body.recoveryId, address: discovery.address, chainId: discovery.chainId } });
  }
  if (action === "recover/options") {
    const address = normalizeEvmAddress(body.address);
    if (typeof body.recoveryId !== "string" || body.recoveryId.length > 128) throw new AppError(ErrorCode.RecoveryIDRequired);
    const a = await store.read(s => s.accounts[body.recoveryId as string]); eligible(a);
    if (a.providerRecovery?.controller?.address !== address) throw new AppError(ErrorCode.NoMatchingVerifiedRecoveryWallet);
    const data = metadata(a, address, body.chainId);
    if (active(a.providerRecovery.operation)) {
      const op = a.providerRecovery.operation!;
      if (op.kind !== "recover" || !op.pendingCredential) throw new AppError(ErrorCode.CompleteEnrollmentBeforeRecovering);
      const p = ownership(context, a, data, "recover", op.pendingCredential.publicKey);
      return issue(context, { purpose: "provider-recovery", value: p.nonce, accountId: a.id, providerPhase: "recover_resume", providerOperationId: op.id, providerProofExpires: p.expiresAt, expires: Date.now() + FLOW_AGE, recovery: { ...data, proof: p } }, { phase: "recover_resume", message: buildRecoveryMessage(p), expiresAt: p.expiresAt });
    }
    const options = await generateRegistrationOptions({ rpName: "DYA ID", rpID: deployment.rpId, userName: `recovered-${a.id.slice(0, 8)}`, userID: new TextEncoder().encode(a.id), supportedAlgorithmIDs: [-7], attestationType: "none", authenticatorSelection: { residentKey: "required", userVerification: "required" }, excludeCredentials: [{ id: a.credentialId, transports: a.transports }] });
    return issue(context, { purpose: "provider-recovery", value: options.challenge, accountId: a.id, providerPhase: "recover_register", hostedOptions: options, providerProofExpires: Date.now() + FIVE_MINUTES, expires: Date.now() + FLOW_AGE, recovery: data }, { phase: "recover_register", options, expiresAt: Date.now() + FIVE_MINUTES });
  }
  if (action === "recover/register") {
    const c = await flow(context, "recover_register");
    const result = await verifyRegistrationResponse({ response: body as unknown as RegistrationResponseJSON, expectedChallenge: c.value, expectedOrigin: deployment.origin, expectedRPID: deployment.rpId, requireUserVerification: true, supportedAlgorithmIDs: [-7] });
    if (!result.verified || !result.registrationInfo) throw new AppError(ErrorCode.ReplacementPasskeyVerificationFailed);
    const credential = result.registrationInfo.credential;
    const publicKey = Buffer.from(credential.publicKey).toString("base64url"); intentsIdentity(publicKey);
    await store.transaction(s => {
      const a = bound(s, c); const controller = a.providerRecovery!.controller!;
      if (active(a.providerRecovery!.operation)) throw new AppError(ErrorCode.AnotherRecoveryIsPending);
      if (Object.values(s.accounts).some(x => x.credentialId === credential.id || x.backup?.id === credential.id)) throw new AppError(ErrorCode.PasskeyAlreadyRegistered);
      const op: ProviderRecoveryOperation = { id: randomUUID(), kind: "recover", phase: "recover_add", sourceCredentialId: a.credentialId!, sourcePublicKey: a.publicKey!, revision: a.providerRecovery!.revision, controllerAddress: controller.address, controllerKey: controller.publicKey, chainId: controller.chainId, pendingCredential: { id: credential.id, publicKey, counter: credential.counter, transports: credential.transports?.filter((t): t is AuthenticatorTransport => ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"].includes(t)) }, revokedKeys: [...new Set([accountIdentity(a).publicKey, ...(a.backup ? [intentsIdentity(a.backup.publicKey).publicKey] : [])])], createdAt: Date.now() };
      const latest = s.challenges[hash(context.ceremony!)]; if (latest.providerPhase !== "recover_register") throw new AppError(ErrorCode.RegistrationAlreadyUsed);
      latest.providerDraft = op; latest.providerOperationId = op.id; latest.providerPhase = op.phase;
    });
    return present(context, await flow(context));
  }
  if (action === "recover/resume") {
    const c = await flow(context, "recover_resume"); const a = await store.read(s => bound(s, c)); const op = operation(a, c);
    verifyRecoverySignature(c.recovery!.proof!, walletSignature(body), { domain: new URL(deployment.origin).host });
    if (recoverPersonalSignPublicKey(buildRecoveryMessage(c.recovery!.proof!), walletSignature(body)) !== op.controllerKey || !await recoveryProvider.hasKey(accountIdentity(a).accountId, op.controllerKey)) throw new AppError(ErrorCode.RecoveryWalletIsNotAuthorized);
    await store.transaction(s => { const current = operation(bound(s, c), c); const challenge = s.challenges[hash(context.ceremony!)]; if (challenge.providerPhase !== "recover_resume") throw new AppError(ErrorCode.ResumeProofAlreadyUsed); challenge.providerPhase = current.phase; delete challenge.recovery!.proof; delete challenge.payload; });
    return present(context, await flow(context));
  }
  if (action === "recover/add" || action === "recover/remove") {
    const phase = action === "recover/add" ? "recover_add" : "recover_remove";
    const pending = action === "recover/add" ? "recover_add_pending" : "recover_remove_pending";
    const c = await flow(context, phase); const a = await store.read(s => bound(s, c)); const op = operation(a, c);
    if (!await recoveryProvider.hasKey(accountIdentity(a).accountId, op.controllerKey)) throw new AppError(ErrorCode.RecoveryControllerIsNoLongerAuthorized);
    if (phase === "recover_remove" && (op.revokedKeys.includes(op.controllerKey) || op.revokedKeys.includes(intentsIdentity(op.pendingCredential!.publicKey).publicKey))) throw new Error("Refusing to remove the recovery or replacement key.");
    return publish(context, c, encodeEvmIntent(c.payload!, walletSignature(body), op.controllerAddress, op.controllerKey), phase, pending);
  }
  if (action === "recover/test" || action === "recover/finish") {
    const phase = action === "recover/test" ? "recover_test" : "recover_finish";
    const c = await flow(context, phase); const a = await store.read(s => bound(s, c)); const op = operation(a, c); const credential = op.pendingCredential!;
    const pending = { ...a, credentialId: credential.id, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports };
    const assertion = body as unknown as AuthenticationResponseJSON;
    const counter = await verifyAssertion(pending, assertion, payloadChallenge(c.payload!).toString("base64url"));
    const auth = await recoveryProvider.authenticate(encodeAssertion({ accountId: accountIdentity(a).accountId, publicKey: intentsIdentity(credential.publicKey).publicKey }, c.payload!, assertion));
    if (!await recoveryProvider.hasKey(accountIdentity(a).accountId, intentsIdentity(credential.publicKey).publicKey)) throw new AppError(ErrorCode.ReplacementKeyIsNoLongerAuthorized);
    if (phase === "recover_test") {
      await store.transaction(s => {
        const current = operation(bound(s, c), c); const challenge = s.challenges[hash(context.ceremony!)];
        if (current.phase !== phase || challenge.providerPhase !== phase || current.pendingCredential!.counter !== credential.counter) throw new AppError(ErrorCode.RecoveryProofAlreadyUsed);
        current.pendingCredential!.counter = counter; current.phase = "recover_remove";
        challenge.providerPhase = current.phase; delete challenge.payload;
      });
      return present(context, await flow(context));
    }
    for (const oldKey of op.revokedKeys) if (await recoveryProvider.hasKey(accountIdentity(a).accountId, oldKey)) throw new AppError(ErrorCode.OldKeyRevocationIsNotFinalized);
    const raw = token(); const expires = Date.now() + SESSION_AGE * 1000;
    const confidential = sealedConfidentialSession(raw, a.id, auth, expires);
    await store.transaction(s => {
      const latest = bound(s, c); const current = operation(latest, c); const challenge = s.challenges[hash(context.ceremony!)];
      if (current.phase !== phase || challenge.providerPhase !== phase || current.pendingCredential!.counter !== credential.counter) throw new AppError(ErrorCode.RecoveryProofAlreadyUsed);
      if (Object.values(s.accounts).some(x => x.credentialId === credential.id || x.backup?.id === credential.id)) throw new AppError(ErrorCode.ReplacementPasskeyAlreadyRegistered);
      latest.credentialId = credential.id; latest.publicKey = credential.publicKey; latest.counter = counter; latest.transports = credential.transports;
      delete latest.backup; delete latest.backupEnrollmentUntil; delete latest.signingCheck;
      latest.providerRecovery!.revision++; current.phase = "complete";
      revoke(s, a.id, ""); s.sessions[hash(raw)] = { accountId: a.id, expires, confidential };
    });
    const res = response({ phase: "complete", recoveryId: a.id }); setCookie(res, SESSION, raw, { ...cookieOptions(), maxAge: SESSION_AGE }); setCookie(res, CEREMONY, "", { ...cookieOptions(), maxAge: 0 }); return res;
  }
  if (action === "status") return present(context, await flow(context));
  throw new AppError(ErrorCode.UnknownProviderRecoveryOperation);
}
