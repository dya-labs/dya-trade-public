import { discoverTokens, requireApprovedPair } from "./token-policy";
import { tokenApproved } from "../../../../../packages/wallet-contracts/src/domain/token-registry";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { accountIdentity } from "../auth/intents";
import { z } from "zod";
import { generateAuthenticationOptions, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAssertion } from "../auth/passkeys";
import { encodeAssertion, payloadChallenge } from "../auth/intents";
import { accountFor, consumeChallenge } from "../repositories/store";
import { readCatalog } from "../providers/catalog";
import { fundingAssets } from "../../../../../packages/wallet-contracts/src/domain/funding-balances";
import { nextRevision } from "../../../../../packages/wallet-contracts/src/domain/reconciliation";
import { prepareFundingBatch, publicFundingBatch, validateFundingLeg, isUnresolvedFundingLeg, fundingBatchState, type StoredFundingBatch } from "./funding-conversions";
import { publishMarketIntent } from "./market-execution";
import { readDepositStatus } from "./one-click-deposit";
import { CEREMONY, cookieOptions, requireAccount, response, saveChallenge, setCookie, type AccountWorkflowContext } from "./workflow-context";
const idInput = z.object({ id: z.string().min(1) });
export async function runFundingConversions(context: AccountWorkflowContext) {
  const { route, body, store, account, session, ceremony, deployment, url, balanceReader } = context;
  if (!route.startsWith("funding/")) return null;
  if (!account.publicKey || !account.credentialId) throw new AppError(ErrorCode.ConnectYourPasskeyFirst);
  const identity = accountIdentity(account);
  const ownedBatch = async (id: string) => {
    const current = await requireAccount(store, session);
    const batch = current.fundingBatches?.[id];
    if (current.id !== account.id || !batch) throw new AppError(ErrorCode.FundingTransferNotFound);
    return batch;
  };
  if (route === "funding/history") return response({ operations: Object.values(account.fundingBatches ?? {}).sort((a, b) => b.createdAt - a.createdAt).map(publicFundingBatch) });
  if (route === "funding/prepare") {
    if (url.hostname !== deployment.rpId) throw new AppError(ErrorCode.OpenDyaIdDirectly);
    if (Object.values(account.fundingBatches ?? {}).some(b => b.legs.some(isUnresolvedFundingLeg))) throw new AppError(ErrorCode.CheckTheExistingTransferBeforeStartingAnother);
    const catalog = await readCatalog();
    await discoverTokens(store, catalog);
    const eligible = await store.read(s => catalog.filter(a => tokenApproved(a, s.tokens?.[a.assetId])));
    const balances = await balanceReader(identity.accountId, undefined, fundingAssets(eligible));
    const batch = await prepareFundingBatch(body, identity.accountId, eligible, balances);
    await store.transaction(s => {
      const current = accountFor(s, session);
      if (!current || current.id !== account.id) throw new AppError(ErrorCode.SessionChangedWithPeriod);
      for (const leg of batch.legs) requireApprovedPair(s, leg.review.pair);
      current.fundingBatches ??= {};
      if (Object.values(current.fundingBatches).some(b => b.legs.some(isUnresolvedFundingLeg))) throw new AppError(ErrorCode.AFundingTransferIsAlreadyProcessing);
      // A new review invalidates every older unsubmitted review/challenge.
      for (const old of Object.values(current.fundingBatches)) {
        old.legs.forEach(l => { if (l.state === "ready") l.state = "cancelled"; });
        old.state = fundingBatchState(old.legs); old.updatedAt = nextRevision(old.updatedAt);
      }
      current.fundingBatches[batch.id] = structuredClone(batch);
    });
    return response({ operation: publicFundingBatch(batch) });
  }
  if (route === "funding/authorize") {
    if (url.hostname !== deployment.rpId) throw new AppError(ErrorCode.OpenDyaIdDirectly);
    const { id, legId } = idInput.extend({ legId: z.string().min(1) }).parse(body);
    const batch = await ownedBatch(id), leg = batch.legs.find(l => l.id === legId);
    if (!leg || leg.state !== "ready") throw new AppError(ErrorCode.ThisRouteIsNoLongerAvailableForSigning);
    if (batch.legs.some(l => ["unknown", "submitting"].includes(l.state))) throw new AppError(ErrorCode.CheckTheUncertainTransferBeforeContinuing);
    validateFundingLeg(leg, identity.accountId);
    await discoverTokens(store, await readCatalog());
    await store.read(s => requireApprovedPair(s, leg.review.pair));
    const options = await generateAuthenticationOptions({ rpID: deployment.rpId, challenge: payloadChallenge(leg.review.payload), userVerification: "required", allowCredentials: [{ id: account.credentialId, transports: account.transports }] });
    const raw = await saveChallenge(store, { purpose: "funding-conversion", value: options.challenge, accountId: account.id,
      fundingBatchId: id, fundingLegId: legId, payload: leg.review.payload, expires: Date.parse(leg.review.expiresAt) }, ceremony);
    const result = response({ options });
    setCookie(result, CEREMONY, raw, { ...cookieOptions(), maxAge: Math.max(1, Math.floor((Date.parse(leg.review.expiresAt) - Date.now()) / 1000)) });
    return result;
  }
  if (route === "funding/submit") {
    const c = await consumeChallenge(store, ceremony ?? "", "funding-conversion");
    if (c.accountId !== account.id || !c.fundingBatchId || !c.fundingLegId || !c.payload) throw new Error("Funding challenge mismatch.");
    const batch = await ownedBatch(c.fundingBatchId), leg = batch.legs.find(l => l.id === c.fundingLegId);
    if (!leg || leg.state !== "ready" || c.payload !== leg.review.payload) throw new AppError(ErrorCode.FundingReviewChanged);
    validateFundingLeg(leg, identity.accountId);
    await discoverTokens(store, await readCatalog());
    await store.read(s => requireApprovedPair(s, leg.review.pair));
    const assertion = body as unknown as AuthenticationResponseJSON;
    const counter = await verifyAssertion(account, assertion, c.value);
    const balances = await balanceReader(identity.accountId, undefined, [leg.asset]);
    if (balances.accountId !== identity.accountId || BigInt(balances.assets.find(a => a.assetId === leg.asset.assetId)?.raw ?? "0") < BigInt(leg.review.inputRaw)) throw new AppError(ErrorCode.FundingBalanceChanged);
    validateFundingLeg(leg, identity.accountId);
    const signed = encodeAssertion(identity, c.payload, assertion);
    await store.transaction(s => {
      const current = accountFor(s, session), active = current?.fundingBatches?.[batch.id], item = active?.legs.find(l => l.id === leg.id);
      if (!current || current.id !== account.id || current.counter !== account.counter || !active || !item || item.state !== "ready" || item.review.payload !== c.payload) throw new AppError(ErrorCode.ConcurrentSignatureOrChangedReview);
      if (active.legs.some(l => ["unknown", "submitting"].includes(l.state))) throw new AppError(ErrorCode.CheckTheUncertainTransferBeforeContinuing);
      validateFundingLeg(item, identity.accountId);
      requireApprovedPair(s, item.review.pair);
      current.counter = counter; item.state = "submitting"; active.state = "processing"; active.updatedAt = nextRevision(active.updatedAt);
    });
    let state: "submitted" | "unknown" = "unknown", intentHash: string | undefined;
    try { const result = await publishMarketIntent(signed, process.env.ONE_CLICK_JWT ?? ""); intentHash = result.intentHash; state = "submitted"; }
    catch { /* A timeout is not proof of rejection. Never retry automatically. */ }
    const operation = await store.transaction(s => {
      const active = s.accounts[account.id].fundingBatches![batch.id], item = active.legs.find(l => l.id === leg.id)!;
      if (item.state === "submitting") { item.state = state; item.intentHash = intentHash; }
      active.state = fundingBatchState(active.legs); active.updatedAt = nextRevision(active.updatedAt); return publicFundingBatch(active);
    });
    return response({ operation });
  }
  if (route === "funding/cancel") {
    const { id } = idInput.parse(body); await ownedBatch(id);
    const operation = await store.transaction(s => {
      const current = accountFor(s, session); if (!current || current.id !== account.id) throw new AppError(ErrorCode.SessionChangedWithPeriod);
      const active = current.fundingBatches![id];
      active.legs.forEach(l => { if (l.state === "ready") l.state = "cancelled"; });
      active.state = fundingBatchState(active.legs); active.updatedAt = nextRevision(active.updatedAt); return publicFundingBatch(active);
    });
    return response({ operation });
  }
  if (route === "funding/status") {
    const { id } = idInput.parse(body), batch = await ownedBatch(id);
    const observations = await Promise.all(batch.legs.filter(isUnresolvedFundingLeg).map(async l => {
      const status = await readDepositStatus({ depositAddress: l.review.depositAddress }, process.env.ONE_CLICK_JWT ?? "");
      return { id: l.id, status: status.status };
    }));
    const operation = await store.transaction(s => {
      const current = accountFor(s, session); if (!current || current.id !== account.id) throw new AppError(ErrorCode.SessionChangedWithPeriod);
      const active: StoredFundingBatch = current.fundingBatches![id];
      for (const o of observations) {
        const leg = active.legs.find(l => l.id === o.id)!;
        if (!isUnresolvedFundingLeg(leg)) continue;
        leg.providerStatus = o.status;
        if (o.status === "SUCCESS") leg.state = "settled";
        else if (o.status === "REFUNDED" || o.status === "FAILED") leg.state = "failed";
        // Pending/incomplete/not-seen are not proof of non-execution.
      }
      active.state = fundingBatchState(active.legs); active.updatedAt = nextRevision(active.updatedAt); return publicFundingBatch(active);
    });
    return response({ operation });
  }
  return null;
}
