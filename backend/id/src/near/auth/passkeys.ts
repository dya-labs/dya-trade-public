import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getDeploymentConfig } from "../../deployment/config";
import { walletClientOrigin } from "../../bridge/config";
import type { Account } from "../repositories/store";

export async function verifyAssertion(
  account: Account,
  assertion: AuthenticationResponseJSON,
  challenge: string,
) {
  if (
    account.kind !== "passkey" ||
    !account.publicKey ||
    !account.credentialId ||
    assertion.id !== account.credentialId
  )
    throw new AppError(ErrorCode.PasskeyAccountMismatch);
  const verified = await verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge: challenge,
    expectedOrigin: getDeploymentConfig().origin,
    // Standalone ceremonies remain valid; hosted embedding requires a configured client.
    expectedTopOrigin: process.env.DYA_TERMINAL_ORIGIN || !getDeploymentConfig().hosted ? walletClientOrigin() : undefined,
    expectedRPID: getDeploymentConfig().rpId,
    credential: {
      id: account.credentialId,
      publicKey: new Uint8Array(Buffer.from(account.publicKey, "base64url")),
      counter: account.counter ?? 0,
      transports: account.transports,
    },
    requireUserVerification: true,
  });
  if (!verified.verified) throw new AppError(ErrorCode.SignatureVerificationFailed);
  return verified.authenticationInfo.newCounter;
}
