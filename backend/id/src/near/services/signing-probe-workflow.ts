import { accountIdentity } from "../auth/intents";
import { setCookie } from "./workflow-context";

import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { verifyAssertion } from "../auth/passkeys";

import { createSigningProbe, encodeAssertion, type SigningCheck } from "../auth/intents";

import { generateAuthenticationOptions, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { accountFor, consumeChallenge } from "../repositories/store";

import { CEREMONY, cookieOptions, response, saveChallenge, type AccountWorkflowContext } from "./workflow-context";

export async function runSigningProbe(context: AccountWorkflowContext) {
  const { route, body, store, deployment, url, session, ceremony, simulator, account } = context;
    if (route === "intents/prepare") {
      if (account.kind !== "passkey" || !account.publicKey)
        throw new AppError(ErrorCode.ConnectAPasskeyToCheckIntentsSigning);
      if (url.hostname !== deployment.rpId)
        throw new AppError(ErrorCode.PasskeyOriginRequired, deployment.origin);
      const { output } = await simulator();
      const identity = accountIdentity(account);
      const probe = createSigningProbe(identity, output.state.current_salt);
      const options = await generateAuthenticationOptions({
        rpID: deployment.rpId,
        challenge: probe.challenge,
        userVerification: "required",
        allowCredentials: [
          { id: account.credentialId!, transports: account.transports },
        ],
      });
      const raw = await saveChallenge(
        store,
        {
          value: options.challenge,
          purpose: "intents",
          payload: probe.payload,
          accountId: account.id,
          expires: probe.expires,
        },
        ceremony,
      );
      const res = response({ options, identity, payload: probe.payload });
      setCookie(res, CEREMONY, raw, { ...cookieOptions(), maxAge: 300 });
      return res;
    }
    if (route === "intents/verify") {
      if (account.kind !== "passkey" || !account.publicKey)
        throw new AppError(ErrorCode.ConnectAPasskeyToCheckIntentsSigning);
      const c = await consumeChallenge(store, ceremony ?? "", "intents");
      if (c.accountId !== account.id || !c.payload)
        throw new AppError(ErrorCode.SigningCheckDoesNotBelongToThisAccount);
      const assertion = body as unknown as AuthenticationResponseJSON;
      const counter = await verifyAssertion(account, assertion, c.value);
      const identity = accountIdentity(account);
      const signed = encodeAssertion(identity, c.payload, assertion);
      await store.transaction((s) => {
        const a = accountFor(s, session);
        if (!a || a.id !== account.id) throw new AppError(ErrorCode.SessionExpired);
        if (a.counter !== account.counter)
          throw new AppError(ErrorCode.ConcurrentSignatureTryAgain);
        a.counter = counter;
      });
      let result: SigningCheck;
      try {
        const simulation = await simulator([signed], undefined, identity);
        result = {
          status: "verified",
          checkedAt: Date.now(),
          accountId: identity.accountId,
          blockHeight: simulation.blockHeight,
          message:
            "Intents verifier accepted the empty signing probe. No blockchain state changed.",
        };
      } catch {
        result = {
          status: "unavailable",
          checkedAt: Date.now(),
          accountId: identity.accountId,
          message:
            "Signature verified locally; the NEAR verifier check did not complete. Retry the check.",
        };
      }
      await store.transaction((s) => {
        const a = accountFor(s, session);
        if (!a || a.id !== account.id) throw new AppError(ErrorCode.SessionExpired);
        a.signingCheck = result;
      });
      return response({ result });
    }
  return null;
}
