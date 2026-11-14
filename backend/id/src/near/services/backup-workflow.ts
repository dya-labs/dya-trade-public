import { accountIdentity } from "../auth/intents";
import { setCookie } from "./workflow-context";

import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { verifyAssertion } from "../auth/passkeys";
import { getDeploymentConfig } from "../../deployment/config";

import { intentsIdentity } from "../auth/intents";

import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, type AuthenticationResponseJSON, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { accountFor, consumeChallenge } from "../repositories/store";

import { CEREMONY, cookieOptions, response, saveChallenge, type AccountWorkflowContext } from "./workflow-context";

export async function runBackup(context: AccountWorkflowContext) {
  const { route, body, store, deployment, url, session, ceremony, account } = context;
    if (route.startsWith("backup/")) {
      if (account.kind !== "passkey" || !account.publicKey || !account.credentialId)
        throw new AppError(ErrorCode.ConnectYourPrimaryPasskeyFirst);
      if (url.hostname !== deployment.rpId) throw new AppError(ErrorCode.PasskeyOriginRequired, deployment.origin);
      if (route === "backup/authorize/options" || route === "backup/test/options") {
        const testing = route === "backup/test/options";
        if (testing && !account.backup) throw new AppError(ErrorCode.CreateABackupFirst);
        if (!testing && account.backup) throw new AppError(ErrorCode.ABackupIsAlreadyPending);
        const options = await generateAuthenticationOptions({
          rpID: deployment.rpId, userVerification: "required",
          allowCredentials: [{ id: testing ? account.backup!.id : account.credentialId,
            transports: testing ? account.backup!.transports : account.transports }],
        });
        const raw = await saveChallenge(store, { value: options.challenge,
          purpose: testing ? "backup-test" : "backup-authorize", accountId: account.id,
          expires: Date.now() + 300000 }, ceremony);
        const res = response(options);
        setCookie(res, CEREMONY, raw, { ...cookieOptions(), maxAge: 300 });
        return res;
      }
      if (route === "backup/authorize/verify" || route === "backup/test/verify") {
        const testing = route === "backup/test/verify";
        const c = await consumeChallenge(store, ceremony ?? "", testing ? "backup-test" : "backup-authorize");
        if (c.accountId !== account.id) throw new AppError(ErrorCode.BackupChallengeAccountMismatch);
        if (testing && !account.backup) throw new AppError(ErrorCode.BackupMissing);
        const signer = testing ? { ...account, credentialId: account.backup!.id,
          publicKey: account.backup!.publicKey, counter: account.backup!.counter,
          transports: account.backup!.transports } : account;
        const counter = await verifyAssertion(signer, body as unknown as AuthenticationResponseJSON, c.value);
        await store.transaction(s => {
          const a = accountFor(s, session);
          if (!a || a.id !== account.id) throw new AppError(ErrorCode.SessionExpired);
          if (testing) {
            if (!a.backup || a.backup.id !== account.backup!.id || a.backup.counter !== signer.counter)
              throw new AppError(ErrorCode.BackupChangedRetry);
            a.backup.counter = counter; a.backup.testedAt = Date.now();
          } else {
            if (a.counter !== account.counter || a.backup) throw new AppError(ErrorCode.AccountChangedRetry);
            a.counter = counter; a.backupEnrollmentUntil = Date.now() + 300000;
          }
        });
        return response({ ok: true });
      }
      if (route === "backup/register/options") {
        if (account.backup || (account.backupEnrollmentUntil ?? 0) <= Date.now())
          throw new AppError(ErrorCode.ApproveBackupSetupWithYourPrimaryPasskeyFirst);
        const options = await generateRegistrationOptions({
          rpName: "DYA ID", rpID: deployment.rpId,
          userName: "backup-" + account.id.slice(0, 8),
          userID: new TextEncoder().encode(account.id), supportedAlgorithmIDs: [-7],
          attestationType: "none",
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
          excludeCredentials: [{ id: account.credentialId, transports: account.transports }],
        });
        const raw = await saveChallenge(store, { value: options.challenge, purpose: "backup-register",
          hostedOptions: options, accountId: account.id, expires: Math.min(Date.now() + 300000, account.backupEnrollmentUntil!) }, ceremony);
        const res = response(options); setCookie(res, CEREMONY, raw, { ...cookieOptions(), maxAge: 300 });
        return res;
      }
      if (route === "backup/register/verify") {
        const c = await consumeChallenge(store, ceremony ?? "", "backup-register");
        if (c.accountId !== account.id || account.backup || (account.backupEnrollmentUntil ?? 0) <= Date.now())
          throw new AppError(ErrorCode.BackupRegistrationNotAuthorized);
        const result = await verifyRegistrationResponse({
          response: body as unknown as RegistrationResponseJSON, expectedChallenge: c.value,
          expectedOrigin: getDeploymentConfig().origin, expectedRPID: getDeploymentConfig().rpId, requireUserVerification: true,
          supportedAlgorithmIDs: [-7],
        });
        if (!result.verified || !result.registrationInfo) throw new AppError(ErrorCode.BackupRegistrationFailed);
        const credential = result.registrationInfo.credential;
        const publicKey = Buffer.from(credential.publicKey).toString("base64url");
        intentsIdentity(publicKey);
        await store.transaction(s => {
          const a = accountFor(s, session);
          if (!a || a.id !== account.id || a.backup || (a.backupEnrollmentUntil ?? 0) <= Date.now())
            throw new AppError(ErrorCode.BackupRegistrationExpired);
          if (Object.values(s.accounts).some(x => x.credentialId === credential.id || x.backup?.id === credential.id))
            throw new AppError(ErrorCode.CredentialIsAlreadyRegistered);
          a.intentsAccountId ??= accountIdentity(a).accountId;
          a.backup = { id: credential.id, publicKey, counter: credential.counter,
            status: "pending_onchain" };
          delete a.backupEnrollmentUntil;
        });
        return response({ ok: true });
      }
      throw new AppError(ErrorCode.UnknownBackupOperation);
    }
  return null;
}
