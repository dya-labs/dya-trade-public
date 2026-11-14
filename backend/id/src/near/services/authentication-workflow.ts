import { accountIdentity } from "../auth/intents";
import { assertRecoverySigningAvailable, localRecoveryEnabled } from "./recovery-mode";
import { createConfidentialOwnershipProbe, intentsIdentity, encodeAssertion } from "../auth/intents";
import { authenticateConfidential } from "../providers/confidential";
import { encryptionKey, rememberConfidentialSession } from "./confidential-sessions";
import { setCookie } from "./workflow-context";

import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { verifyAssertion } from "../auth/passkeys";
import { getDeploymentConfig } from "../../deployment/config";

import { accountName } from "../../../../../packages/wallet-contracts/src/http/schemas/account";

import { randomUUID } from "node:crypto";

import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, type AuthenticationResponseJSON, type RegistrationResponseJSON, type AuthenticatorTransport } from "@simplewebauthn/server";
import { accountFor, consumeChallenge, hash } from "../repositories/store";

import { SESSION, CEREMONY, cookieOptions, response, newSession, saveChallenge, type WorkflowContext } from "./workflow-context";

export async function runAuthentication(context: WorkflowContext) {
  const { route, body, store, deployment, session, ceremony } = context;
    if (route === "auth/logout") {
      await store.transaction((s) => {
        if (session) delete s.sessions[hash(session)];
        if (ceremony) delete s.challenges[hash(ceremony)];
      });
      const res = response({ ok: true });
      setCookie(res, SESSION, "", { ...cookieOptions(), maxAge: 0 });
      setCookie(res, CEREMONY, "", { ...cookieOptions(), maxAge: 0 });
      return res;
    }
    if (route === "auth/register/options") {
      if (await store.read((s) => accountFor(s, session)))
        throw new AppError(ErrorCode.SignOutBeforeCreatingANewPasskeyAccount);
      const parsedName = body.name === undefined ? undefined : accountName.safeParse(body.name);
      if (parsedName && !parsedName.success) throw new AppError(ErrorCode.InvalidRequest);
      const name = parsedName?.data;
      const userId = randomUUID();
      const options = await generateRegistrationOptions({
        rpName: "DYA ID",
        rpID: deployment.rpId,
        userName: name ?? `tester-${userId.slice(0, 8)}`,
        userDisplayName: name,
        userID: new TextEncoder().encode(userId),
        supportedAlgorithmIDs: [-7],
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      });
      const raw = await saveChallenge(
        store,
        {
          value: options.challenge,
          purpose: "register",
          userId,
          ...(name ? { accountName: name } : {}),
          expires: Date.now() + 300000,
        },
        ceremony,
      );
      const res = response(options);
      setCookie(res, CEREMONY, raw, { ...cookieOptions(), maxAge: 300 });
      return res;
    }
    if (route === "auth/register/verify") {
      const c = await consumeChallenge(store, ceremony ?? "", "register");
      const result = await verifyRegistrationResponse({
        response: body as unknown as RegistrationResponseJSON,
        expectedChallenge: c.value,
        expectedOrigin: getDeploymentConfig().origin,
        expectedRPID: getDeploymentConfig().rpId,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7],
      });
      if (!result.verified || !result.registrationInfo || !c.userId)
        throw new AppError(ErrorCode.PasskeyRegistrationFailed);
      const credential = result.registrationInfo.credential;
      await store.transaction((s) => {
        if (
          Object.values(s.accounts).some(
            (a) => a.credentialId === credential.id || a.backup?.id === credential.id,
          )
        )
          throw new AppError(ErrorCode.ThisPasskeyIsAlreadyRegistered);
        s.accounts[c.userId!] = {
          id: c.userId!,
          kind: "passkey",
          ...(c.accountName ? { name: c.accountName } : {}),
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString("base64url"),
          counter: credential.counter,
          ...(localRecoveryEnabled() ? { localRecovery: { originalIdentity: intentsIdentity(Buffer.from(credential.publicKey).toString("base64url")), revision: 0 } } : {}),
          transports: credential.transports?.filter(
            (t): t is AuthenticatorTransport =>
              [
                "ble",
                "cable",
                "hybrid",
                "internal",
                "nfc",
                "smart-card",
                "usb",
              ].includes(t),
          ),
        };
      });
      return await newSession(store, c.userId, session);
    }
    if (route === "auth/login/options") {
      // A credential hint selects the account before constructing its ownership
      // proof. It is public metadata, never authorization or a session token.
      const hinted = typeof body.credentialId === "string" && body.credentialId.length <= 2048
        ? await store.read(s => Object.values(s.accounts).find(a => a.credentialId === body.credentialId && a.publicKey)) : undefined;
      const probe = hinted?.publicKey && !hinted.localRecovery
        ? createConfidentialOwnershipProbe(accountIdentity(hinted), (await context.simulator()).output.state.current_salt) : undefined;
      const options = await generateAuthenticationOptions({
        rpID: deployment.rpId,
        userVerification: "required",
        ...(probe && hinted ? { challenge: probe.challenge, allowCredentials: [{ id: hinted.credentialId!, transports: hinted.transports }] } : {}),
      });
      const raw = await saveChallenge(
        store,
        {
          value: options.challenge,
          purpose: "login",
          ...(probe && hinted ? { payload: probe.payload, accountId: hinted.id } : {}),
          expires: probe?.expires ?? Date.now() + 300000,
        },
        ceremony,
      );
      const res = response(options);
      setCookie(res, CEREMONY, raw, { ...cookieOptions(), maxAge: 300 });
      return res;
    }
    if (route === "auth/login/verify") {
      const c = await consumeChallenge(store, ceremony ?? "", "login");
      // Read-only: the counter transaction below rechecks credential, key, and counter.
      const a = await store.read((s) =>
        Object.values(s.accounts).find(
          (a) => a.kind === "passkey" && a.credentialId === body.id,
        ),
      );
      if (!a)
        throw new AppError(ErrorCode.PasskeyIsNotRegisteredWithThisTerminal);
      assertRecoverySigningAvailable(a);
      if (c.payload && c.accountId !== a.id) throw new Error("Sign-in proof belongs to another account.");
      const assertion = body as unknown as AuthenticationResponseJSON;
      if (
        assertion.response.userHandle &&
        assertion.response.userHandle !==
          Buffer.from(a.id).toString("base64url")
      )
        throw new AppError(ErrorCode.IncorrectUserHandle);
      const counter = await verifyAssertion(a, assertion, c.value);
      await store.transaction((s) => {
        if (s.accounts[a.id]?.credentialId !== a.credentialId || s.accounts[a.id]?.publicKey !== a.publicKey || (s.accounts[a.id].counter ?? 0) !== a.counter)
          throw new AppError(ErrorCode.ConcurrentAuthenticationTryAgain);
        s.accounts[a.id].counter = counter;
      });
      // Authenticate both services with the very same locally verified assertion.
      // A provider failure must not report an unlocked or completed sign-in.
      if (c.payload) encryptionKey();
      const auth = c.payload ? await authenticateConfidential(encodeAssertion(accountIdentity(a), c.payload, assertion)) : undefined;
      const result = await newSession(store, a.id, session, a.credentialId);
      if (auth) await rememberConfidentialSession(store, result.cookies.find(c => c.name === SESSION)!.value, a.id, auth);
      return { ...result, body: { ...result.body, confidentialUnlocked: !!auth } };
    }
  return null;
}
