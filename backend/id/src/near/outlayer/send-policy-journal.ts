import { randomUUID } from "node:crypto";
import { tradingWithdrawalState } from "./trading-withdrawal-state";
import { verifyStoredPolicy } from "./activation-checks";
import { accountFor, type State, type StateStore } from "../repositories/store";
import { isLegacyTradingAccount } from "./accounts";
import { broadcastSetupTransaction } from "./near-transactions";
import { confirmPolicyExecution } from "./policy-execution";
import { sendPolicyState, nextSendPolicy, type SendPolicyEvent, type SendPolicyState } from "./send-policy-state";

export function sendPolicyJournal(store: StateStore, session: string, walletId: string) {
  function select(state: State) {
    const account = accountFor(state, session);
    if (!account?.credentialId || !account.publicKey || account.localRecovery) throw new Error("Trading wallet unavailable.");
    const legacy = isLegacyTradingAccount(account, walletId);
    const record = legacy ? undefined : Object.hasOwn(account.outlayerTradingAccounts ?? {}, walletId)
      ? account.outlayerTradingAccounts?.[walletId] : undefined;
    if (!legacy && !record) throw new Error("Trading wallet unavailable.");
    const preferences = legacy ? account.outlayerLegacySetup : record;
    const draft = legacy ? account.outlayerSetupDraft : record?.draft;
    const activation = legacy ? account.outlayerActivation : record?.activation;
    if (preferences?.lifecycle?.phase === "discarded" || draft?.phase !== "policy-ready" ||
        draft.credentialId !== account.credentialId || draft.publicKey !== account.publicKey ||
        !activation || !("outcome" in activation) || activation.outcome !== "active" ||
        activation.plan.accountId !== account.id || activation.plan.credentialId !== account.credentialId ||
        activation.plan.publicKey !== account.publicKey || activation.plan.draftId !== draft.id ||
        activation.plan.walletId !== draft.walletId || activation.plan.walletPublicKey !== draft.walletPublicKey ||
        activation.plan.controllerId !== draft.controllerId) throw new Error("Trading wallet unavailable.");
    return { account, draft, activation, record, policy: preferences?.sendPolicy };
  }

  function change(expected: SendPolicyState, event: SendPolicyEvent, assertion?: { credentialId: string; counter: number | undefined; nextCounter: number }) {
    return store.transaction(state => {
      const { account, record, policy } = select(state);
      if (!policy || policy.phase !== expected.phase || policy.requestId !== expected.requestId) {
        throw new Error("The policy update changed. Refresh its status.");
      }
      if (assertion) {
        if (account.credentialId !== assertion.credentialId || account.counter !== assertion.counter) throw new Error("Passkey changed during approval.");
        account.counter = assertion.nextCounter;
      }
      const next = nextSendPolicy(policy, event);
      if (!next) throw new Error("Invalid policy update transition.");
      if (record) record.sendPolicy = next;
      else (account.outlayerLegacySetup ??= {}).sendPolicy = next;
      return next;
    });
  }

  function selectWithdrawal(state: State, id: string) {
    const { account, draft, record } = select(state);
    const withdrawals = (record ?? account.outlayerLegacySetup)?.withdrawals;
    const operation = withdrawals && Object.hasOwn(withdrawals, id) ? withdrawals[id] : undefined;
    if (!withdrawals || !operation || operation.draftId !== draft.id) throw new Error("Withdrawal unavailable.");
    return { account, draft, withdrawals, operation };
  }

  return {
    read: () => store.read(select),
    saveWithdrawalReview(draftId: string, review: { internal?: true; assetId?: string; decimals?: number; symbol?: string; recipient: string; rawAmount: string; estimatedRawAmount: string; deadline: string }) {
      const operation = tradingWithdrawalState.parse({ ...review, draftId, id: randomUUID(), phase: "review" });
      return store.transaction(state => {
        const { account, draft, record } = select(state);
        if (draft.id !== draftId || Date.parse(operation.deadline) <= Date.now()) {
          throw new Error("The withdrawal quote expired or the Trading wallet changed.");
        }
        const preferences = record ?? (account.outlayerLegacySetup ??= {});
        const withdrawals = (preferences.withdrawals ??= {});
        for (const [id, existing] of Object.entries(withdrawals)) {
          if (existing.phase === "review" && Date.parse(existing.deadline) <= Date.now()) delete withdrawals[id];
        }
        withdrawals[operation.id] = operation;
        return operation;
      });
    },
    change,
    claimWithdrawalProposal(id: string) {
      return store.transaction(state => {
        const { account, draft, record } = select(state);
        const withdrawals = (record ?? account.outlayerLegacySetup)?.withdrawals;
        const operation = withdrawals && Object.hasOwn(withdrawals, id) ? withdrawals[id] : undefined;
        if (!operation || operation.draftId !== draft.id || Date.parse(operation.deadline) <= Date.now() ||
            (operation.phase !== "review" && operation.phase !== "proposing")) {
          throw new Error("Withdrawal review expired or changed.");
        }
        const next = { ...operation, phase: "proposing" as const };
        withdrawals![id] = next;
        return { accountId: account.id, draft, operation: next };
      });
    },
    saveWithdrawalProposal(id: string, requestId: string, approvalId: string) {
      return store.transaction(state => {
        const { account, draft, record } = select(state);
        const withdrawals = (record ?? account.outlayerLegacySetup)?.withdrawals;
        const operation = withdrawals && Object.hasOwn(withdrawals, id) ? withdrawals[id] : undefined;
        if (!operation || operation.draftId !== draft.id) throw new Error("Withdrawal changed.");
        if (operation.phase === "awaiting-approval" && operation.requestId === requestId && operation.approvalId === approvalId) return operation;
        if (operation.phase !== "proposing") throw new Error("Withdrawal proposal changed.");
        const next = tradingWithdrawalState.parse({ ...operation, phase: "awaiting-approval", requestId, approvalId });
        withdrawals![id] = next;
        return next;
      });
    },
    readWithdrawal: (id: string) => store.read(state => {
      const { account, draft, operation } = selectWithdrawal(state, id);
      return { accountId: account.id, draft, operation };
    }),
    markWithdrawalSubmitted(id: string, requestId: string) {
      return store.transaction(state => {
        const { withdrawals, operation } = selectWithdrawal(state, id);
        if (!("requestId" in operation) || operation.requestId !== requestId) throw new Error("Withdrawal changed.");
        if (operation.phase !== "awaiting-approval") return operation;
        const next = tradingWithdrawalState.parse({ ...operation, phase: "submitted" });
        withdrawals[id] = next;
        return next;
      });
    },
    completeWithdrawal(id: string, requestId: string, outcome: "settled" | "failed" | "unknown") {
      return store.transaction(state => {
        const { withdrawals, operation } = selectWithdrawal(state, id);
        if (!("requestId" in operation) || operation.requestId !== requestId) throw new Error("Withdrawal changed.");
        if (operation.phase === "complete") return operation;
        const next = tradingWithdrawalState.parse({ ...operation, phase: "complete", outcome });
        withdrawals[id] = next;
        return next;
      });
    },
    async ready() {
      const { draft, policy } = await store.read(select);
      if (policy?.phase !== "confirmed" && (policy || !draft.policyKind)) return false;
      if ((policy ? policy.policyKind : draft.policyKind) !== "transfer-v3") return false;
      await verifyStoredPolicy({
        controllerId: draft.controllerId,
        walletPublicKey: draft.walletPublicKey,
        encryptedPolicy: policy?.encryptedPolicy ?? draft.encryptedPolicy,
        version: policy?.version ?? 1,
      });
      return true;
    },
    saveProposal(expectedDraftId: string, proposal: Extract<SendPolicyState, { phase: "proposed" | "voted" }>) {
      sendPolicyState.parse(proposal);
      return store.transaction(state => {
        const { account, draft, record, policy } = select(state);
        if (draft.id !== expectedDraftId) throw new Error("The Trading wallet changed.");
        if (policy && policy.phase !== "failed" && policy.phase !== "confirmed") throw new Error("A policy update is already recorded.");
        if (record) record.sendPolicy = proposal;
        else (account.outlayerLegacySetup ??= {}).sendPolicy = proposal;
        return proposal;
      });
    },
    async reconcile(rebroadcast = false) {
      const { draft, policy } = await store.read(select);
      if (policy?.phase !== "submitted") return policy;
      const status = await confirmPolicyExecution(policy.transaction, {
        controllerId: draft.controllerId,
        walletPublicKey: draft.walletPublicKey,
        encryptedPolicy: policy.encryptedPolicy,
        version: policy.version,
        locked: !policy.unlockedTradingTest,
      });
      if (status === "success") return change(policy, { type: "policy-confirmed", transactionHash: policy.transaction.hash });
      if (status === "failed") return change(policy, { type: "transaction-failed" });
      if (rebroadcast) await broadcastSetupTransaction(policy.transaction.bytes);
      return policy;
    },
  };
}
