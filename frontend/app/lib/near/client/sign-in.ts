"use client";
import { DYA_BRAND, TOAST_MESSAGES } from "@dya/config";
import { connect, startAuthentication, type WalletPresentation } from "@dya/wallet-sdk";
import { prepareConfidentialAccess, unlockConfidentialAccess } from "../http/confidential-client";
import { snapshot } from "../http/schemas/account";
import { AppError, ErrorCode } from "../domain/errors";
function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Wallet action is no longer active.", "AbortError");
}
export async function unlockBalances(signal?: AbortSignal) {
  assertActive(signal);
  const { options } = await prepareConfidentialAccess();
  assertActive(signal);
  const assertion = await startAuthentication({ optionsJSON: options });
  assertActive(signal);
  await unlockConfidentialAccess(assertion);
  assertActive(signal);
}
export function passkeyError(error: unknown) {
  if (error && typeof error === "object" && (("name" in error && error.name === "NotAllowedError") || ("code" in error && error.code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY")))
    return TOAST_MESSAGES.confirmationIncomplete;
  return error instanceof Error ? error.message : TOAST_MESSAGES.passkeyFailed;
}
/** Resolves with the new connection's session, so callers need no follow-up state request. */
export async function signIn(kind: "login" | "register", onProgress: (message: string) => void, onPresentationChange?: (mode: WalletPresentation) => void) {
  onProgress(kind === "register" ? `Create your passkey in ${DYA_BRAND.idName}.` : "Connect your DYA wallet.");
  const session = snapshot.safeParse(await (onPresentationChange ? connect(kind, { onPresentationChange }) : connect(kind)));
  if (!session.success) throw new AppError(ErrorCode.InvalidApiResponse);
  return session.data;
}
