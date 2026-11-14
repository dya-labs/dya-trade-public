import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { accountIdentity } from "../auth/intents";
import { fundingAssets } from "../../../../../packages/wallet-contracts/src/domain/funding-balances";
import { z } from "zod";
import { generateAuthenticationOptions, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAssertion } from "../auth/passkeys";
import { encodeAssertion, payloadChallenge } from "../auth/intents";
import { accountFor, consumeChallenge } from "../repositories/store";
import { readCatalog } from "../providers/catalog";
import { prepareConsolidation, relayRpc, validateConsolidation } from "./consolidation";
import { CEREMONY, cookieOptions, requireAccount, response, saveChallenge, setCookie, type AccountWorkflowContext } from "./workflow-context";
import type { ConsolidationOperation } from "../../../../../packages/wallet-contracts/src/http/schemas/consolidation";
const unresolved = (op: ConsolidationOperation) => ["submitting", "submitted", "unknown"].includes(op.state);
export async function runConsolidation(context: AccountWorkflowContext) {
  const { route, body, store, account, session, ceremony, deployment, url, balanceReader } = context;
  if (!route.startsWith("funding/")) return null;
  if (!account.publicKey || !account.credentialId) throw new AppError(ErrorCode.ConnectYourPasskeyFirst);
  const identity = accountIdentity(account);
  if (route === "funding/history") return response({ operations: Object.values(account.consolidations ?? {}).sort((a, b) => b.createdAt - a.createdAt) });
  if (route === "funding/prepare") {
    if (url.hostname !== deployment.rpId) throw new AppError(ErrorCode.OpenDyaIdDirectly);
    if (Object.values(account.consolidations ?? {}).some(unresolved)) throw new AppError(ErrorCode.CheckTheExistingTransferBeforeStartingAnother);
    const catalog = await readCatalog();
    const balances = await balanceReader(identity.accountId, undefined, fundingAssets(catalog));
    const prepared = await prepareConsolidation(body, identity.accountId, catalog, balances);
    if ((await requireAccount(store, session)).id !== account.id) throw new AppError(ErrorCode.SessionChangedWithPeriod);
    const options = await generateAuthenticationOptions({ rpID: deployment.rpId, challenge: payloadChallenge(prepared.payload), userVerification: "required", allowCredentials: [{ id: account.credentialId, transports: account.transports }] });
    const raw = await saveChallenge(store, { purpose: "consolidation", value: options.challenge, accountId: account.id, expires: Date.parse(prepared.review.expiresAt), consolidation: prepared }, ceremony);
    const result = response({ options, review: prepared.review });
    setCookie(result, CEREMONY, raw, { ...cookieOptions(), maxAge: Math.max(1, Math.floor((Date.parse(prepared.review.expiresAt) - Date.now()) / 1000)) });
    return result;
  }
  if (route === "funding/submit") {
    const c = await consumeChallenge(store, ceremony ?? "", "consolidation");
    if (c.accountId !== account.id || !c.consolidation) throw new Error("Funding challenge mismatch.");
    const prepared = c.consolidation;
    const intentHash = validateConsolidation(prepared, identity.accountId);
    const assertion = body as unknown as AuthenticationResponseJSON;
    const counter = await verifyAssertion(account, assertion, c.value);
    const signed = encodeAssertion(identity, prepared.payload, assertion);
    const balances = await balanceReader(identity.accountId, undefined, prepared.review.inputs.map(i => i.asset));
    if (prepared.review.inputs.some(i => BigInt(balances.assets.find(a => a.assetId === i.asset.assetId)?.raw ?? "0") < BigInt(i.raw))) throw new AppError(ErrorCode.FundingBalanceChanged);
    validateConsolidation(prepared, identity.accountId);
    const op: ConsolidationOperation = { id: prepared.review.id, createdAt: Date.now(), state: "submitting", intentHash, review: prepared.review };
    await store.transaction(s => {
      const current = accountFor(s, session);
      if (!current || current.id !== account.id || current.counter !== account.counter) throw new AppError(ErrorCode.SessionChangedOrConcurrentSignature);
      current.consolidations ??= {};
      if (Object.values(current.consolidations).some(unresolved)) throw new AppError(ErrorCode.AFundingTransferIsAlreadyInProgress);
      current.counter = counter;
      current.consolidations[op.id] = op;
    });
    let state: ConsolidationOperation["state"] = "unknown";
    try {
      const published = z.object({ status: z.enum(["OK", "FAILED"]), intent_hash: z.string().optional() }).parse(await relayRpc("publish_intent", { quote_hashes: prepared.quoteHashes, signed_data: signed }));
      if (published.status === "FAILED") state = "failed";
      else if (published.intent_hash === intentHash) state = "submitted";
    } catch { /* Persist unknown outcome; never automatically retry a submission. */ }
    const operation = await store.transaction(s => {
      const current = s.accounts[account.id].consolidations![op.id];
      if (current.state !== "settled") current.state = state;
      return current;
    });
    return response({ operation });
  }
  if (route === "funding/status") {
    const id = z.string().parse(body.id);
    const op = account.consolidations?.[id];
    if (!op) throw new AppError(ErrorCode.FundingTransferNotFound);
    if (op.state === "settled" || op.state === "failed") return response({ operation: op });
    const result = z.object({ intent_hash: z.string(), status: z.enum(["PENDING", "TX_BROADCASTED", "SETTLED", "NOT_FOUND_OR_NOT_VALID"]), data: z.object({ hash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/).optional() }).nullish() }).parse(await relayRpc("get_status", { intent_hash: op.intentHash }));
    if (result.intent_hash !== op.intentHash) throw new Error("Funding status identity mismatch.");
    const operation = await store.transaction(s => {
      const current = s.accounts[account.id].consolidations![id];
      if (current.state === "settled" || current.state === "failed") return current;
      if (result.status === "SETTLED" && result.data?.hash) { current.state = "settled"; current.txHash = result.data.hash; }
      else if (result.status === "PENDING" || result.status === "TX_BROADCASTED") current.state = "submitted";
      else current.state = "unknown"; // Not-found is not proof of non-execution.
      return current;
    });
    return response({ operation });
  }
  return null;
}
