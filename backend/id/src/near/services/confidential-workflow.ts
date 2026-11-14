import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { accountIdentity } from "../auth/intents";
import { ASSETS, type LiveBalances } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";
import { generateAuthenticationOptions, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { payloadChallenge, encodeAssertion, createConfidentialOwnershipProbe } from "../auth/intents";
import { verifyAssertion } from "../auth/passkeys";
import { accountFor, consumeChallenge } from "../repositories/store";
import { authenticateConfidential } from "../providers/confidential";
import { readCatalog } from "../providers/catalog";
import { CEREMONY, cookieOptions, response, saveChallenge, setCookie, type AccountWorkflowContext } from "./workflow-context";
import { rememberConfidentialSession, confidentialSessionBalances } from "./confidential-sessions";
import type { SnapshotReader, StateStore } from "../repositories/store";
export async function runConfidential(context: AccountWorkflowContext) {
  const { route, account, session, store, ceremony, deployment, url, body } = context;
  if (!route.startsWith("confidential/")) return null;
  if (!session || !account.publicKey || !account.credentialId) throw new AppError(ErrorCode.ConnectYourPasskeyFirst);
  const identity = accountIdentity(account);
  if (route === "confidential/prepare") {
    if (url.hostname !== deployment.rpId) throw new AppError(ErrorCode.OpenDyaIdDirectly);
    // Read only the verifier's shared salt. Never send account data or a signed
    // ownership message to the public RPC.
    const { output } = await context.simulator();
    const { payload, expires } = createConfidentialOwnershipProbe(identity, output.state.current_salt);
    const options = await generateAuthenticationOptions({ rpID: deployment.rpId, challenge: payloadChallenge(payload), userVerification: "required", allowCredentials: [{ id: account.credentialId, transports: account.transports }] });
    const raw = await saveChallenge(store, { purpose: "confidential-auth", value: options.challenge, payload, accountId: account.id, expires }, ceremony);
    const result = response({ options });
    setCookie(result, CEREMONY, raw, { ...cookieOptions(), maxAge: 300 });
    return result;
  }
  if (route === "confidential/unlock") {
    const c = await consumeChallenge(store, ceremony ?? "", "confidential-auth");
    if (c.accountId !== account.id || !c.payload) throw new Error("Confidential challenge mismatch.");
    const assertion = body as unknown as AuthenticationResponseJSON;
    const counter = await verifyAssertion(account, assertion, c.value);
    await store.transaction(s => { const current = accountFor(s, session); if (!current || current.id !== account.id || current.counter !== account.counter) throw new AppError(ErrorCode.SessionChangedTryAgain); current.counter = counter; });
    const auth = await authenticateConfidential(encodeAssertion(identity, c.payload, assertion));
    // rememberConfidentialSession rechecks the live grant in its atomic write.
    // A separate read here cannot strengthen that guarded revocation check.
    await rememberConfidentialSession(store, session, account.id, auth);
    // The ID dashboard asks for its all-asset balances in the same request. The bridged
    // unlock never does: approval results are stored, and balances must not be.
    if (url.searchParams.get("balances") !== "all") return response({ unlocked: true });
    // Access is already granted; a failed read leaves the client to fetch balances itself.
    const balances = await readCatalog()
      .then(assets => privateLiveBalances(store, session, account.id, identity.accountId, assets))
      .catch((error: unknown) => { console.warn({ event: "confidential.unlock.balances_unavailable", code: error instanceof AppError ? error.code : "UNEXPECTED" }); return undefined; });
    return response({ unlocked: true, ...(balances ? { balances } : {}) });
  }
  if (route === "confidential/balances") {
    return response(await confidentialSessionBalances(store, session, account.id));
  }
  return null;
}

export async function privateLiveBalances(store: StateStore, session: string | undefined, accountId: string, identity: string, assets: readonly { assetId: string; symbol: string; decimals: number }[] = ASSETS, held?: SnapshotReader): Promise<LiveBalances> {
  const result = await confidentialSessionBalances(store, session, accountId, held);
  const values = new Map<string, string>();
  for (const balance of result.balances) {
    if (values.has(balance.tokenId)) throw new Error("Duplicate private token balance.");
    values.set(balance.tokenId, balance.available);
  }
  return { accountId: identity, blockHeight: 0, checkedAt: Date.now(), assets: assets.map(asset => {
    const raw = values.get(asset.assetId) ?? "0";
    return { ...asset, raw, amount: new D(raw).div(new D(10).pow(asset.decimals)).toFixed() };
  }) };
}
