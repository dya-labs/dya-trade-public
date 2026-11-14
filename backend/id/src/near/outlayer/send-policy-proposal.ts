import { randomUUID } from "node:crypto";
import { verifyPolicyWrite } from "./policy-write";
import { readLockedPolicyVersion, verifyStoredPolicy } from "./activation-checks";
import { preparePolicyUpdateVote } from "./controller-vote";
import type { sendPolicyJournal } from "./send-policy-journal";
import { baseUsdc, nearUsdc, readTradingPolicy, bootstrapPolicy, withdrawalPolicy, encryptWalletPolicy, proposeLockedPolicyUpdate, signUnlockedAssetPolicy } from "./setup-draft";

export async function prepareUnlockedAssets(journal: ReturnType<typeof sendPolicyJournal>, allowedAssets: string[]) {
  const { account, draft, policy } = await journal.read();
  if (!policy?.unlockedTradingTest || policy.policyKind !== "send-disabled" || !["confirmed", "failed"].includes(policy.phase)) {
    throw new Error("The unlocked trading policy is unavailable.");
  }
  const currentVersion = await readLockedPolicyVersion(draft.controllerId, draft.walletPublicKey, fetch, false);
  if (policy.phase === "confirmed") {
    await verifyStoredPolicy({ ...draft, encryptedPolicy: policy.encryptedPolicy, version: policy.version, locked: false });
  }
  const active = await readTradingPolicy(account.id, draft);
  if (active.approval.locked || active.capabilities.cross_chain_withdraw?.allowed !== false ||
      active.rules.transaction_types.some(type => !["confidential", "swap", "limit_order"].includes(type))) {
    throw new Error("The active trading policy changed.");
  }
  const replacement = {
    ...active,
    wallet_id: draft.walletId,
    rules: { ...active.rules, allowed_tokens: allowedAssets },
  };
  const encrypted = await encryptWalletPolicy(account.id, draft, replacement);
  const unlockedAssetWrite = await signUnlockedAssetPolicy(account.id, draft, encrypted.encrypted_base64);
  const version = Number(unlockedAssetWrite.version);
  if (!Number.isSafeInteger(version) || version !== currentVersion + 1) throw new Error("Unexpected OutLayer policy version.");
  verifyPolicyWrite(unlockedAssetWrite, { ...draft, version, locked: false, encryptedPolicy: encrypted.encrypted_base64, policyHash: encrypted.policy_hash });
  await journal.saveProposal(draft.id, {
    phase: "voted", unlockedTradingTest: true, unlockedAssetWrite,
    previousAllowedAssets: active.rules.allowed_tokens, allowedAssets,
    tradingEnabled: true, previousTradingEnabled: true, policyKind: "send-disabled",
    approvalId: randomUUID(), requestId: randomUUID(), version,
    encryptedPolicy: encrypted.encrypted_base64, policyHash: encrypted.policy_hash,
  });
}

export async function prepareSendPolicyProposal(journal: ReturnType<typeof sendPolicyJournal>, enabled?: boolean, allowedAssets?: string[], tradingEnabled?: boolean, excludeTradeApproval?: true, unlockedTradingTest?: true) {
  const { account, draft, policy } = await journal.read();
  if (policy && policy.phase !== "proposed" && policy.phase !== "failed" && policy.phase !== "confirmed") {
    throw new Error("A Trading policy update is already in progress.");
  }
  if (policy?.phase === "confirmed" && policy.unlockedTradingTest) throw new Error("The test policy is already active.");
  if (unlockedTradingTest && (enabled !== undefined || allowedAssets || tradingEnabled !== undefined || excludeTradeApproval)) {
    throw new Error("Review the unlocked test policy separately.");
  }
  const currentVersion = await readLockedPolicyVersion(draft.controllerId, draft.walletPublicKey);
  const identity = { controllerId: draft.controllerId, walletPublicKey: draft.walletPublicKey, currentVersion };
  if (policy?.phase === "proposed") {
    if (unlockedTradingTest && !policy.unlockedTradingTest) throw new Error("A different policy update is pending.");
    if (enabled !== undefined && enabled !== (policy.policyKind !== "send-disabled")) throw new Error("A different Send update is pending.");
    if (excludeTradeApproval && !policy.tradeApprovalExclusions) throw new Error("A different policy update is pending.");
    if (tradingEnabled !== undefined && tradingEnabled !== policy.tradingEnabled) throw new Error("A different Trading update is pending.");
    if (allowedAssets && JSON.stringify(allowedAssets) !== JSON.stringify(policy.allowedAssets)) throw new Error("A different policy update is pending.");
    return preparePolicyUpdateVote({
      ...identity, approvalId: policy.approvalId, policyHash: policy.policyHash, proposedVersion: policy.version, locked: !policy.unlockedTradingTest,
    });
  }
  const savedAssets = policy?.allowedAssets ?? (policy?.addNearUsdc ? [baseUsdc, nearUsdc] : undefined);
  const next = enabled === false ? bootstrapPolicy : withdrawalPolicy;
  let replacement: Parameters<typeof encryptWalletPolicy>[2] & { wallet_id: string; approval: object } = next(draft.walletId, draft.controllerId);
  if (!allowedAssets && enabled !== false && savedAssets) replacement.rules.allowed_tokens = savedAssets;
  if (allowedAssets) {
    if (enabled === false || !await journal.ready()) throw new Error("Enable Send before adding assets.");
    const active = await readTradingPolicy(account.id, draft);
    replacement = {
      ...active,
      wallet_id: draft.walletId,
      rules: { ...active.rules, allowed_tokens: allowedAssets },
    };
  }
  const previousTradingEnabled = (policy?.phase === "confirmed" ? policy.tradingEnabled : policy?.previousTradingEnabled) ?? false;
  const previousTradeApprovalExclusions = policy?.phase === "confirmed"
    ? policy.tradeApprovalExclusions
    : policy?.previousTradeApprovalExclusions;
  if (excludeTradeApproval && !previousTradingEnabled) throw new Error("Enable swaps and limit orders first.");
  const tradeApprovalExclusions = tradingEnabled !== false && (excludeTradeApproval ?? previousTradeApprovalExclusions ?? false);
  const nextTradingEnabled = tradingEnabled ?? previousTradingEnabled;
  if (unlockedTradingTest) {
    if (policy?.phase !== "confirmed" || policy.transactionHash !== "c1PUrhEwh9MoiutEZ8fBomaqfvexXSkhRCDYv4qRVUR" || !policy.tradeApprovalExclusions) throw new Error("The trade exclusions must be confirmed first.");
    const active = await readTradingPolicy(account.id, draft);
    const bootstrap = bootstrapPolicy(draft.walletId, draft.controllerId);
    replacement = {
      ...active,
      wallet_id: draft.walletId,
      approval: { locked: false },
      rules: { ...active.rules, transaction_types: ["confidential", "swap", "limit_order"], addresses: { mode: "whitelist", list: [draft.walletPublicKey] } },
      capabilities: { ...bootstrap.capabilities, confidential: { allowed: true }, swap: { allowed: true }, limit_order: { allowed: true }, cross_chain_withdraw: { allowed: false } },
    };
  } else if (excludeTradeApproval) {
    if (enabled !== undefined || allowedAssets || tradingEnabled !== undefined) {
      throw new Error("Review trade approval exclusions separately.");
    }
    const active = await readTradingPolicy(account.id, draft);
    replacement = {
      ...active,
      wallet_id: draft.walletId,
      approval: { ...active.approval, excluded_types: ["swap", "limit_order"] },
    };
  } else if (tradingEnabled !== undefined || nextTradingEnabled) {
    const active = await readTradingPolicy(account.id, draft);
    const capabilities: typeof active.capabilities = { ...active.capabilities, ...replacement.capabilities };
    const tradeTypes = ["swap", "limit_order"];
    for (const type of tradeTypes) capabilities[type] = { ...active.capabilities[type], allowed: !!nextTradingEnabled, requires_approval: false };
    const transactionTypes = active.rules.transaction_types.filter(type => !tradeTypes.includes(type) &&
      (enabled !== false || !["confidential", "withdraw", "cross_chain_withdraw"].includes(type)));
    replacement = {
      ...active,
      wallet_id: draft.walletId,
      approval: tradeApprovalExclusions ? { ...active.approval, excluded_types: tradeTypes }
        : previousTradeApprovalExclusions ? { ...active.approval, excluded_types: [] }
        : active.approval,
      rules: {
        ...active.rules,
        allowed_tokens: allowedAssets ?? active.rules.allowed_tokens,
        transaction_types: [...new Set([...transactionTypes, ...replacement.rules.transaction_types.filter(type => tradingEnabled === undefined || enabled === true), ...(nextTradingEnabled ? tradeTypes : [])])],
      },
      capabilities: tradingEnabled !== undefined && enabled === undefined
        ? { ...active.capabilities, swap: capabilities.swap, limit_order: capabilities.limit_order }
        : capabilities,
    };
  }
  const sendEnabled = !unlockedTradingTest && (enabled ?? ((tradingEnabled === undefined && !excludeTradeApproval) || await journal.ready()));
  const encrypted = await encryptWalletPolicy(account.id, draft, replacement);
  const proposal = await proposeLockedPolicyUpdate(account.id, draft, encrypted.encrypted_base64, fetch, !unlockedTradingTest);
  const vote = await preparePolicyUpdateVote({
    ...identity, approvalId: proposal.approval_id, policyHash: encrypted.policy_hash, locked: !unlockedTradingTest,
  });
  await journal.saveProposal(draft.id, {
    phase: "proposed",
    unlockedTradingTest,
    tradingEnabled: nextTradingEnabled,
    tradeApprovalExclusions,
    previousTradeApprovalExclusions,
    previousTradingEnabled,
    ...((allowedAssets ?? savedAssets) ? { allowedAssets: allowedAssets ?? savedAssets } : {}),
    previousEnabled: policy?.phase === "failed" ? policy.previousEnabled : await journal.ready(),
    policyKind: !sendEnabled ? "send-disabled" : "transfer-v3",
    approvalId: proposal.approval_id,
    requestId: proposal.request_id,
    policyHash: encrypted.policy_hash,
    encryptedPolicy: encrypted.encrypted_base64,
    version: vote.version,
  });
  return vote;
}
