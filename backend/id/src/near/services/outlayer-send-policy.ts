import { accountIdentity } from "../auth/intents";
import { selectedTradingAccount, tradingAccountsView } from "../outlayer/accounts";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";
import { z } from "zod";
import { readCatalog } from "../providers/catalog";
import { DEFAULT_PAIR, makePair } from "../../../../../packages/wallet-contracts/src/domain/catalog";
import { requireToken, requireTradingPair } from "./token-policy";
import { requireNetwork } from "./network-policy";
import { checkActivationContracts, readLockedPolicyVersion, verifyStoredPolicy } from "../outlayer/activation-checks";
import { baseUsdc, nearUsdc, tradingOrderRequest, TradingOrderRejected, proposeTradingWithdrawal, readTradingWithdrawalStatus, readOutlayerTradingBalances, quoteTradingWithdrawal, readApprovedPolicyWrite, PolicyProposalEnded } from "../outlayer/setup-draft";
import { estimatePolicyStorage } from "../outlayer/policy-storage";
import { preparePolicyExecution, signPolicyExecution } from "../outlayer/policy-execution";
import { broadcastSetupTransaction, nativeBalance, policyFilingSponsor } from "../outlayer/near-transactions";
import { readSetupNetworkPricing } from "../outlayer/network-pricing";
import { generateAuthenticationOptions, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAssertion } from "../auth/passkeys";
import { accountFor, consumeChallenge, hash } from "../repositories/store";
import { controllerApprovalHash, ownerRequestHash } from "../outlayer/owner-request";
import { prepareControllerVote, submitControllerVote } from "../outlayer/controller-vote";
import { verifyPolicyWrite } from "../outlayer/policy-write";
import { prepareUnlockedAssets, prepareSendPolicyProposal } from "../outlayer/send-policy-proposal";
import type { SendPolicyState } from "../outlayer/send-policy-state";
import { sendPolicyJournal } from "../outlayer/send-policy-journal";
import { CEREMONY, cookieOptions, response, saveChallenge, setCookie, type AccountWorkflowContext } from "./workflow-context";

function confirmedAllowedAssets(policy: SendPolicyState | undefined) {
  if (policy?.phase !== "confirmed") return policy?.previousAllowedAssets ?? [baseUsdc];
  return policy.allowedAssets ?? (policy.addNearUsdc ? [baseUsdc, nearUsdc] : [baseUsdc]);
}

export async function runSendPolicy(context: AccountWorkflowContext) {
  const { route, session, store, url, deployment, body, ceremony } = context;
  if (!route.startsWith("outlayer/send-policy/")) return null;
  const walletId = url.searchParams.get("account");
  const withdrawalRoute = /^outlayer\/send-policy\/withdrawal-(quote|proposal|options|approve|status)$/.test(route);
  const tradeRoute = route === "outlayer/send-policy/trade" || route === "outlayer/send-policy/trade-quote";
  const tradeStatusRoute = route === "outlayer/send-policy/trade-access";
  if ((deployment.hosted && !withdrawalRoute && !tradeRoute && !tradeStatusRoute) || !session || !walletId) return response({ error: "Trading wallet unavailable" }, 404);
  const journal = sendPolicyJournal(store, session, walletId);
  const { account, draft, policy } = await journal.read();
  if (tradeStatusRoute) return response({ enabled: policy?.phase === "confirmed" && policy.unlockedTradingTest === true && policy.policyKind === "send-disabled", allowedAssets: confirmedAllowedAssets(policy) });
  if (tradeRoute) {
    if (policy?.phase !== "confirmed" || !policy.unlockedTradingTest || policy.policyKind !== "send-disabled") {
      return response({ error: "The unlocked trading test policy is required." }, 409);
    }
    await verifyStoredPolicy({ ...draft, encryptedPolicy: policy.encryptedPolicy, version: policy.version, locked: false });
    const order = z.object({
      id: z.uuid(), base: z.string(), quote: z.string(), side: z.enum(["buy", "sell"]),
      rawAmount: z.string().regex(/^[1-9][0-9]{0,37}$/),
      expiryHours: z.union([z.literal(1), z.literal(24), z.literal(168)]).optional(),
      price: z.string().regex(/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,18})?$/).refine(value => new D(value).gt(0)).optional(),
    }).strict().parse(body);
    const allowed = confirmedAllowedAssets(policy);
    if (order.base === order.quote || !allowed.includes(order.base) || !allowed.includes(order.quote)) {
      return response({ error: "This pair is outside the Trading wallet’s allowed assets." }, 400);
    }
    const catalog = await readCatalog();
    const base = catalog.find(asset => asset.assetId === order.base);
    const quote = catalog.find(asset => asset.assetId === order.quote);
    if (!base || !quote) return response({ error: "Trading assets are unavailable." }, 409);
    await store.read(state => {
      if (quote.assetId === DEFAULT_PAIR.quote.assetId) {
        requireTradingPair(state, makePair(base, quote));
      } else {
        requireToken(state, base, "trading");
        requireToken(state, quote, "trading");
      }
    });
    if (order.price && route.endsWith("/trade-quote")) return response({ error: "Invalid swap quote" }, 400);
    try {
      const result = order.price
        ? await tradingOrderRequest(account.id, draft, "limit-orders", {
          base_asset: order.base, quote_asset: order.quote, side: order.side, quantity: order.rawAmount, price: order.price,
          deposit_type: "confidential_intents", deadline: new Date(Date.now() + (order.expiryHours ?? 24) * 3_600_000).toISOString(),
        }, order.id)
        : await tradingOrderRequest(account.id, draft, route.endsWith("/trade-quote") ? "confidential/swap/quote" : "confidential/swap", {
          token_in: order.side === "buy" ? order.quote : order.base,
          token_out: order.side === "buy" ? order.base : order.quote,
          amount_in: order.rawAmount,
        }, order.id);
      return response(result);
    } catch (error) {
      if (error instanceof TradingOrderRejected) return response({ error: error.message }, 422);
      throw error;
    }
  }
  const allowedAssets = confirmedAllowedAssets(policy);
  async function checkWithdrawalEligibility(ownerId: string, wallet: typeof draft, rawAmount: string, assetId: string = baseUsdc) {
    const asset = (await readCatalog()).find(token => token.assetId === assetId);
    if (!asset) return response({ error: "USDC on Base is unavailable" }, 409);
    await store.read(state => {
      requireToken(state, asset, "withdrawals");
      requireNetwork(state, asset.blockchain, "withdrawals");
    });
    const balances = await readOutlayerTradingBalances(ownerId, wallet);
    const balance = balances.find(item => item.token === assetId)?.balance ?? "0";
    if (BigInt(rawAmount) > BigInt(balance)) return response({ error: "Insufficient Trading balance" }, 409);
  }
  if (route === "outlayer/send-policy/withdrawal-quote") {
    if (!await journal.ready() || !allowedAssets.includes(baseUsdc)) return response({ error: "Trading Send policy required" }, 409);
    if (typeof body.recipient !== "string" || typeof body.rawAmount !== "string") {
      return response({ error: "Invalid withdrawal details" }, 400);
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(body.recipient) || /^0x0{40}$/.test(body.recipient) ||
        !/^[1-9][0-9]{0,37}$/.test(body.rawAmount)) {
      return response({ error: "Invalid withdrawal details" }, 400);
    }
    const eligibilityError = await checkWithdrawalEligibility(account.id, draft, body.rawAmount);
    if (eligibilityError) return eligibilityError;
    const quote = await quoteTradingWithdrawal(account.id, draft, {
      recipient: body.recipient, rawAmount: body.rawAmount,
    });
    // Dry-run estimates are not execution constraints.
    const review = await journal.saveWithdrawalReview(draft.id, {
      recipient: body.recipient, rawAmount: body.rawAmount, estimatedRawAmount: quote.amount_out, deadline: quote.deadline,
    });
    return response({ id: review.id, estimatedRawAmount: review.estimatedRawAmount, deadline: review.deadline });
  }
  if (route.endsWith("/internal-assets")) {
    if (!await journal.ready()) return response({ assets: [], reason: "policy" });
    const catalog = await readCatalog();
    const assets = [];
    for (const asset of catalog.filter(item => allowedAssets.includes(item.assetId))) {
      const { assetId, symbol, decimals, blockchain } = asset;
      const eligibility = await checkWithdrawalEligibility(account.id, draft, "1", assetId);
      if (!eligibility) assets.push({ assetId, symbol, decimals, blockchain });
    }
    return response({ assets, reason: assets.length ? undefined : "asset" });
  }
  if (route.endsWith("/internal-review")) {
    if (!await journal.ready()) return response({ error: "Trading Send policy required" }, 409);
    const assetId = z.string().parse(body.assetId);
    const asset = (await readCatalog()).find(item => item.assetId === assetId && allowedAssets.includes(assetId));
    if (!asset) return response({ error: "Asset unavailable under Send policy" }, 409);
    const destination = z.string().parse(body.destination);
    const rawAmount = z.string().regex(/^[1-9][0-9]{0,37}$/).parse(body.rawAmount);
    let recipient: string;
    if (destination === "main") recipient = accountIdentity(account).accountId;
    else {
      if (destination === walletId || !tradingAccountsView(account).wallets.some(wallet => wallet.id === destination)) {
        return response({ error: "Choose another account" }, 400);
      }
      const target = selectedTradingAccount(account, destination).outlayerSetupDraft;
      if (target?.phase !== "policy-ready") return response({ error: "Destination unavailable" }, 409);
      recipient = target.walletPublicKey;
    }
    if (recipient === draft.walletPublicKey) return response({ error: "Choose another account" }, 400);
    const error = await checkWithdrawalEligibility(account.id, draft, rawAmount, assetId);
    if (error) return error;
    const review = await journal.saveWithdrawalReview(draft.id, {
      internal: true, assetId, decimals: asset.decimals, symbol: asset.symbol, recipient, rawAmount, estimatedRawAmount: rawAmount,
      deadline: new Date(Date.now() + 120_000).toISOString(),
    });
    return response({ id: review.id, deadline: review.deadline });
  }
  if (route === "outlayer/send-policy/withdrawal-proposal") {
    const id = z.uuid().parse(body.id);
    const { operation, ...existing } = await journal.readWithdrawal(id);
    if (operation.phase === "complete") return response({ id, phase: operation.phase, outcome: operation.outcome });
    if (operation.phase === "submitted") return response({ id, phase: operation.phase });
    if (operation.phase === "awaiting-approval") {
      return response({ id, phase: operation.phase, approvalId: operation.approvalId });
    }
    if (!await journal.ready()) return response({ error: "Trading Send policy required" }, 409);
    await checkActivationContracts();
    if (operation.phase === "review") {
      const eligibilityError = await checkWithdrawalEligibility(existing.accountId, existing.draft, operation.rawAmount, operation.assetId);
      if (eligibilityError) return eligibilityError;
    }
    if (!allowedAssets.includes(operation.assetId ?? baseUsdc)) return response({ error: "Asset unavailable under Send policy" }, 409);
    const claimed = await journal.claimWithdrawalProposal(id);
    const { recipient, rawAmount } = claimed.operation;
    const provider = await proposeTradingWithdrawal(claimed.accountId, claimed.draft, { internal: claimed.operation.internal, assetId: claimed.operation.assetId, recipient, rawAmount, idempotencyKey: id });
    await journal.saveWithdrawalProposal(id, provider.request_id, provider.approval_id);
    return response({ id, phase: "awaiting-approval", approvalId: provider.approval_id });
  }
  if (route.endsWith("/withdrawal-options") || route.endsWith("/withdrawal-approve")) {
    if (url.hostname !== deployment.rpId || !account.credentialId || !await journal.ready()) {
      return response({ error: "Trading withdrawal approval unavailable" }, 409);
    }
    const id = z.uuid().parse(body.id ?? url.searchParams.get("withdrawal"));
    const { operation } = await journal.readWithdrawal(id);
    if (!allowedAssets.includes(operation.assetId ?? baseUsdc) || operation.phase !== "awaiting-approval" || Date.parse(operation.deadline) <= Date.now()) {
      return response({ error: "Withdrawal review expired or changed" }, 409);
    }
    const message = await prepareControllerVote({
      approvalId: operation.approvalId,
      walletPublicKey: draft.walletPublicKey,
      controllerId: draft.controllerId,
      canonicalOperation: canonical => {
        z.object({
          kind: z.literal("confidential"),
          flow: z.literal(operation.internal ? "transfer" : "withdraw"),
          chain: operation.internal ? z.literal("near").optional() : z.literal("base"),
          to: z.literal(operation.recipient),
          token: z.literal(operation.assetId ?? baseUsdc),
          amount: z.literal(operation.rawAmount),
        }).strict().parse(JSON.parse(canonical));
        return canonical;
      },
    });
    if (route.endsWith("/withdrawal-options")) {
      const options = await generateAuthenticationOptions({
        rpID: deployment.rpId, challenge: controllerApprovalHash(message), userVerification: "required",
        allowCredentials: [{ id: account.credentialId, transports: account.transports }],
      });
      const expires = Date.parse(operation.deadline);
      const token = await saveChallenge(store, {
        purpose: "outlayer-withdrawal", value: options.challenge, accountId: account.id, expires,
        hostedOptions: options,
        outlayerWithdrawalReview: {
          asset: operation.symbol ?? "USDC",
          amount: new D(operation.rawAmount).div(new D(10).pow(operation.decimals ?? 6)).toFixed(),
          estimatedReceive: new D(operation.estimatedRawAmount).div(new D(10).pow(operation.decimals ?? 6)).toFixed(),
          recipient: operation.recipient, network: operation.internal ? "Confidential Intents" : "Base",
          expires: operation.deadline,
        },
        outlayerSendPolicy: { walletId, withdrawalId: id, requestId: operation.requestId, sessionHash: hash(session), message },
      }, ceremony, context.bind);
      const result = response({ options });
      setCookie(result, CEREMONY, token, { ...cookieOptions(), maxAge: Math.max(1, Math.ceil((expires - Date.now()) / 1000)) });
      return result;
    }
    const challenge = await consumeChallenge(store, ceremony ?? "", "outlayer-withdrawal");
    const binding = challenge.outlayerSendPolicy;
    if (challenge.accountId !== account.id || !binding || binding.walletId !== walletId ||
        (binding.withdrawalId !== undefined && binding.withdrawalId !== id) ||
        binding.requestId !== operation.requestId || binding.sessionHash !== hash(session) ||
        binding.message.payload !== message.payload || binding.message.signer_id !== message.signer_id ||
        controllerApprovalHash(binding.message).toString("base64url") !== challenge.value) {
      return response({ error: "Withdrawal approval expired or changed" }, 409);
    }
    const assertion = (body.assertion ?? body) as AuthenticationResponseJSON;
    const counter = await verifyAssertion(account, assertion, challenge.value);
    await store.transaction(state => {
      const current = accountFor(state, session);
      if (!current || current.credentialId !== account.credentialId || current.publicKey !== account.publicKey || current.counter !== account.counter) {
        throw new Error("Passkey changed during withdrawal approval.");
      }
      current.counter = counter;
    });
    const vote = await submitControllerVote(operation.approvalId, binding.message, assertion);
    if (vote.request_id && vote.request_id !== operation.requestId) throw new Error("OutLayer returned a different withdrawal.");
    if (vote.status === "approved") await journal.markWithdrawalSubmitted(id, operation.requestId);
    return response({ withdrawal: {
      id, state: vote.status === "approved" ? "submitted" : "unknown",
      review: { amount: new D(operation.rawAmount).div(new D(10).pow(operation.decimals ?? 6)).toFixed(), asset: operation.symbol ?? "USDC", destinationChain: operation.internal ? "Confidential Intents" : "Base" },
    }, terminal: false });
  }
  if (route === "outlayer/send-policy/withdrawal-status") {
    const id = z.uuid().parse(body.id);
    const { accountId, draft: selectedDraft, operation } = await journal.readWithdrawal(id);
    const review = { amount: new D(operation.rawAmount).div(new D(10).pow(operation.decimals ?? 6)).toFixed(), asset: operation.symbol ?? "USDC", destinationChain: operation.internal ? "Confidential Intents" : "Base" };
    const result = (state: "settled" | "failed" | "unknown" | "submitted", terminal: boolean) =>
      response({ withdrawal: { id, state, review }, terminal });
    if (operation.phase === "complete") return result(operation.outcome, true);
    if (!("requestId" in operation)) return result("unknown", false);
    const status = await readTradingWithdrawalStatus(accountId, selectedDraft, operation.requestId);
    if (!status.terminal) {
      if (status.state === "submitted" && operation.phase === "awaiting-approval") {
        const reconciled = await journal.markWithdrawalSubmitted(id, operation.requestId);
        if (reconciled.phase === "complete") return result(reconciled.outcome, true);
      }
      return result(status.state, status.terminal);
    }
    const completed = await journal.completeWithdrawal(id, operation.requestId, status.state);
    if (completed.phase !== "complete") throw new Error("Withdrawal settlement changed.");
    return result(completed.outcome, true);
  }
  if (route.endsWith("/vote-options")) {
    const unlockedTradingTest = z.literal(true).optional().parse(body.unlockedTradingTest);
    const excludeTradeApproval = z.literal(true).optional().parse(body.excludeTradeApproval);
    const tradingEnabled = z.boolean().optional().parse(body.tradingEnabled);
    const enabled = z.boolean().optional().parse(body.enabled);
    const assets = z.array(z.string().min(1).max(256)).max(100).optional().parse(body.allowedAssets);
    if (policy?.unlockedTradingTest && assets && enabled === undefined && tradingEnabled === undefined && !excludeTradeApproval && !unlockedTradingTest) {
      const selected = [...new Set(assets)].sort();
      const catalog = await readCatalog();
      await store.read(state => {
        for (const id of selected) {
          if (allowedAssets.includes(id)) continue;
          const asset = catalog.find(item => item.assetId === id);
          if (!asset) throw new Error("Unknown Trading asset.");
          requireToken(state, asset, "trading");
        }
      });
      await prepareUnlockedAssets(journal, selected);
      return response({ phase: "voted" });
    }
    if (assets) {
      const catalog = await readCatalog();
      await store.read(state => {
        for (const id of new Set(assets)) {
          if (allowedAssets.includes(id)) continue;
          const asset = catalog.find(item => item.assetId === id);
          if (!asset) throw new Error("Unknown Send asset.");
          requireToken(state, asset, "withdrawals");
          requireNetwork(state, asset.blockchain, "withdrawals");
        }
      });
    }
    const { message } = await prepareSendPolicyProposal(journal, enabled, assets && [...new Set(assets)].sort(), tradingEnabled, excludeTradeApproval, unlockedTradingTest);
    const { policy: proposal } = await journal.read();
    if (proposal?.phase !== "proposed") throw new Error("Policy proposal unavailable.");
    const options = await generateAuthenticationOptions({
      rpID: deployment.rpId, challenge: controllerApprovalHash(message), userVerification: "required",
      allowCredentials: [{ id: account.credentialId!, transports: account.transports }],
    });
    const token = await saveChallenge(store, {
      purpose: "outlayer-send-policy", value: options.challenge, accountId: account.id, expires: Date.now() + 120000,
      outlayerSendPolicy: { walletId, requestId: proposal.requestId, sessionHash: hash(session), message },
    }, ceremony, context.bind);
    const result = response({ options });
    setCookie(result, CEREMONY, token, { ...cookieOptions(), maxAge: 120 });
    return result;
  }
  if (route.endsWith("/vote")) {
    const challenge = await consumeChallenge(store, ceremony ?? "", "outlayer-send-policy");
    const binding = challenge.outlayerSendPolicy;
    if (policy?.phase !== "proposed" || !binding || binding.walletId !== walletId ||
        binding.requestId !== policy.requestId || binding.sessionHash !== hash(session) ||
        challenge.accountId !== account.id || controllerApprovalHash(binding.message).toString("base64url") !== challenge.value) {
      return response({ error: "Policy approval expired or changed" }, 409);
    }
    const { message } = await prepareSendPolicyProposal(journal);
    if (message.payload !== binding.message.payload || message.signer_id !== binding.message.signer_id) {
      return response({ error: "Policy approval expired or changed" }, 409);
    }
    const assertion = body as unknown as AuthenticationResponseJSON;
    const counter = await verifyAssertion(account, assertion, challenge.value);
    await store.transaction(state => {
      const current = accountFor(state, session);
      if (!current || current.credentialId !== account.credentialId || current.publicKey !== account.publicKey || current.counter !== account.counter) {
        throw new Error("Passkey changed during policy approval.");
      }
      current.counter = counter;
    });
    const vote = await submitControllerVote(policy.approvalId, binding.message, assertion);
    if (vote.request_id && vote.request_id !== policy.requestId) {
      throw new Error("OutLayer returned a different policy request.");
    }
    if (vote.status === "pending") return response({ phase: "proposed" }, 202);
    await journal.change(policy, { type: "vote-confirmed" });
    return response({ phase: "voted" });
  }
  if (route.endsWith("/execution-options")) {
    if (policy?.phase !== "voted") return response({ error: "Policy vote required" }, 409);
    const write = policy.unlockedAssetWrite
      ? verifyPolicyWrite(policy.unlockedAssetWrite, { ...draft, ...policy, locked: false })
      : await readApprovedPolicyWrite(account.id, draft, policy).catch(async error => {
      if (!(error instanceof PolicyProposalEnded)) throw error;
      await journal.change(policy, { type: "proposal-ended" });
      throw error;
    });
    if (!write) return response({ phase: "voted" }, 202);
    await checkActivationContracts();
    const [storage, pricing, balance] = await Promise.all([
      estimatePolicyStorage({ walletPublicKey: draft.walletPublicKey, encryptedPolicy: policy.encryptedPolicy }),
      readSetupNetworkPricing(),
      nativeBalance(policyFilingSponsor().accountId),
    ]);
    const gasPriceCap = pricing.gasPurchasePriceYoctoNear;
    if (BigInt(balance) < BigInt(storage.yoctoNear) + BigInt(gasPriceCap) * BigInt(300_000_000_000_000)) {
      return response({ error: "Policy transaction payer needs NEAR for storage and gas." }, 409);
    }
    const message = preparePolicyExecution(draft.controllerId, write, storage.yoctoNear);
    const options = await generateAuthenticationOptions({
      rpID: deployment.rpId, challenge: ownerRequestHash(message), userVerification: "required",
      allowCredentials: [{ id: account.credentialId!, transports: account.transports }],
    });
    const token = await saveChallenge(store, {
      purpose: "outlayer-policy-execution", value: options.challenge, accountId: account.id, expires: Date.now() + 120000,
      outlayerPolicyExecution: { walletId, requestId: policy.requestId, sessionHash: hash(session), message, gasPriceCap },
    }, ceremony, context.bind);
    const result = response({ options, storageYoctoNear: storage.yoctoNear });
    setCookie(result, CEREMONY, token, { ...cookieOptions(), maxAge: 120 });
    return result;
  }
  if (route.endsWith("/execute")) {
    const challenge = await consumeChallenge(store, ceremony ?? "", "outlayer-policy-execution");
    const binding = challenge.outlayerPolicyExecution;
    if (policy?.phase !== "voted" || !binding || binding.walletId !== walletId ||
        binding.requestId !== policy.requestId || binding.sessionHash !== hash(session) || challenge.accountId !== account.id) {
      return response({ error: "Policy filing approval expired or changed" }, 409);
    }
    const assertion = body as unknown as AuthenticationResponseJSON;
    const counter = await verifyAssertion(account, assertion, challenge.value);
    await checkActivationContracts();
    if (binding.message.signer_id !== draft.controllerId ||
        await readLockedPolicyVersion(draft.controllerId, draft.walletPublicKey, fetch, !policy.unlockedAssetWrite) >= policy.version) {
      return response({ error: "The on-chain policy changed before filing." }, 409);
    }
    const transaction = await signPolicyExecution(policyFilingSponsor().seed, binding.gasPriceCap, binding.message, assertion, challenge.value);
    await journal.change(policy, { type: "transaction-signed", transaction }, { credentialId: account.credentialId!, counter: account.counter, nextCounter: counter });
    try { await broadcastSetupTransaction(transaction.bytes); } catch { /* Reconcile the recorded transaction by hash. */ }
    return response({ phase: "submitted" });
  }
  if (route.endsWith("/rebroadcast")) {
    const current = await journal.reconcile(true);
    return response({ phase: current?.phase ?? "disabled" });
  }
  if (route.endsWith("/status")) {
    let current = await journal.reconcile();
    // A lost vote response can leave OutLayer approved while the local journal
    // still says proposed. Recover using the exact verified signed policy.
    if (current?.phase === "proposed") {
      try {
        if (await readApprovedPolicyWrite(account.id, draft, current)) {
          current = await journal.change(current, { type: "vote-confirmed" });
        }
      } catch (error) {
        if (!(error instanceof PolicyProposalEnded)) throw error;
        current = await journal.change(current, { type: "proposal-ended" });
      }
    }
    const ready = await journal.ready();
    const sendEnabled = ready && (current ? current.policyKind : draft.policyKind) === "transfer-v3";
    const pending = current?.phase === "proposed" || current?.phase === "voted" || current?.phase === "submitted" ? current : undefined;
    return response({
      allowedAssets: confirmedAllowedAssets(current),
      canUnlockTradingTest: current?.phase === "confirmed" && current.transactionHash === "c1PUrhEwh9MoiutEZ8fBomaqfvexXSkhRCDYv4qRVUR",
      unlockedTradingTest: current?.unlockedTradingTest === true && (current.phase === "confirmed" || !!current.unlockedAssetWrite),
      pendingUnlockedTradingTest: pending?.unlockedTradingTest === true && !pending.unlockedAssetWrite,
      tradeApprovalExclusions: (current?.phase === "confirmed" ? current.tradeApprovalExclusions : current?.previousTradeApprovalExclusions) ?? false,
      pendingTradeApprovalExclusions: pending?.tradeApprovalExclusions === true && !pending.previousTradeApprovalExclusions,
      tradingEnabled: (current?.phase === "confirmed" ? current.tradingEnabled : current?.previousTradingEnabled) ?? false,
      pendingTradingEnabled: pending?.tradingEnabled !== pending?.previousTradingEnabled ? pending?.tradingEnabled : undefined,
      pendingAssets: pending?.allowedAssets,
      sendEnabled: current && current.phase !== "confirmed" ? current.previousEnabled ?? false : sendEnabled,
      pendingEnabled: pending ? pending.policyKind !== "send-disabled" : undefined,
      phase: pending?.phase ?? (sendEnabled ? "confirmed" : current?.phase === "failed" ? "failed" : "disabled"),
      ...(current?.phase === "confirmed" ? { transactionHash: current.transactionHash } : {}),
    });
  }
  return null;
}
