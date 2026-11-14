import { DYA_WALLET_NAMES } from "@dya/config";
import { runOutlayerActivation, activationPilotEnabled, activationStatus } from "./outlayer-activation-workflow";
import { runOutlayerRecovery } from "./outlayer-recovery-workflow";
import { createTradingAccount,tradingAccountStore,legacyTradingSetupStore,isLegacyTradingAccount,resumeTradingAccount,discardTradingSetup,saveTradingPaymentAsset,selectedTradingAccount } from "../outlayer/accounts";
import { prepareSetupDraft } from "../outlayer/setup-draft";
import { z } from "zod";
import { getDeploymentConfig } from "../../deployment/config";
import { accountIdentity } from "../auth/intents";
import { previewSetupQuote } from "../outlayer/setup-preview";
import { readRelayerReadiness } from "../outlayer/relayer";
import { createHash, randomBytes } from "node:crypto";
import { generateAuthenticationOptions, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAssertion } from "../auth/passkeys";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import type { Account } from "../repositories/store";
import type { OutlayerSetupView } from "../../../../../packages/wallet-contracts/src/domain/outlayer-setup";
import { accountFor, consumeChallenge, hash } from "../repositories/store";
import { checkPublishedOwnerCode, ownerPlan } from "../outlayer/owner";
import { CEREMONY, cookieOptions, response, saveChallenge, setCookie, type AccountWorkflowContext } from "./workflow-context";

export function outlayerSetupView(account: Account): OutlayerSetupView {
  const plan = ownerPlan(account.publicKey!);
  const saved = account.outlayerOwnerCheck;
  const op = account.outlayerActivation;
  const installed = !!op?.plan.recoveryControllerId && (op.phase === "refund" || op.phase === "complete") && op.outcome === "active" && op.plan.credentialId === account.credentialId && op.plan.publicKey === account.publicKey && op.plan.recoveryCredentialId === account.outlayerRecovery?.id;
  const current = saved && saved.publicKey === account.publicKey && saved.credentialId === account.credentialId && saved.controllerId === plan.controllerId && saved.codeHash === plan.codeHash;
  return { network: "mainnet", name: DYA_WALLET_NAMES.legacyTrading, originalUnchanged: true, owner: current ? "verified" : "unchecked", ...(current ? { checkedAt: saved.checkedAt } : {}), controllerId: plan.controllerId,
    recovery: { status: !account.outlayerRecovery ? "needed" : account.outlayerRecovery.sourceCredentialId === account.credentialId && account.outlayerRecovery.sourcePublicKey === account.publicKey ? "prepared" : "review-required", ...(account.outlayerRecovery ? { verifiedAt: account.outlayerRecovery.verifiedAt } : {}), authority: "full-owner", installedOnChain: installed },
    canProvision: false, blockers: activationPilotEnabled(getDeploymentConfig().hosted) ? ["Pilot uses a mutable publisher. Immutable code and migration are required before going live."] : ["Activation pilot is disabled. No setup payment can be approved."] };
}

/** Readiness is descriptive only; even a funded relayer cannot provision here. */
export async function readOutlayerSetup(account: Account) {
  const setup = outlayerSetupView(account);
  try {
    const relayer = await readRelayerReadiness();
    const blockers = setup.blockers.filter(item => !item.startsWith("Mainnet payer"));
    if (relayer.status === "unconfigured") blockers.unshift("Setup relayer is not configured.");
    else {
      if (!activationPilotEnabled(getDeploymentConfig().hosted) && relayer.nativeBalanceYoctoNear === "0") blockers.unshift("Setup relayer needs native NEAR for gas.");
    }
    if (!installedSetup(account)) blockers.unshift("Prepare an exact activation review before approving payment; planning estimates cannot authorize spending.");
    return { ...setup, relayer, blockers };
  } catch {
    return { ...setup, blockers: ["Setup relayer verification is unavailable. No payment can be approved.", ...setup.blockers.filter(item => !item.startsWith("Mainnet payer"))] };
  }
}

/** This slice performs only RPC reads and WebAuthn verification. There is no signer. */
export async function runOutlayerSetup(context: AccountWorkflowContext, checkCode = checkPublishedOwnerCode, verify = verifyAssertion) {
  if(!context.route.startsWith("outlayer/"))return null;
  const original=context;
  const selected=context.url.searchParams.get('account');
  if(!context.route.startsWith("outlayer/accounts/")) {
    const store=selected&&!isLegacyTradingAccount(context.account,selected)?tradingAccountStore(context.store,context.account.id,selected):legacyTradingSetupStore(context.store,context.account.id);
    const account=await store.read(s=>accountFor(s,context.session)!);
    context={...context,store,account,held:undefined};
  }
  const { route, account, store, session, ceremony, deployment, url, body } = context;
  if (!route.startsWith("outlayer/")) return null;
  if (url.hostname !== deployment.rpId) throw new AppError(ErrorCode.PasskeyOriginRequired, deployment.origin);
  if (!account.publicKey || !account.credentialId) throw new AppError(ErrorCode.InvalidRequest);
  if(route==='outlayer/accounts/resume'){
    if(!activationPilotEnabled(deployment.hosted))return response({error:'Account creation is unavailable.'},404);
    z.object({}).strict().parse(body);
    return response({account:await resumeTradingAccount(original.store,session!)});
  }
  if(route==='outlayer/accounts/discard'||route==='outlayer/accounts/payment-asset'){
    if(!activationPilotEnabled(deployment.hosted))return response({error:'Account creation is unavailable.'},404);
    const id=url.searchParams.get('account');if(!id)throw new AppError(ErrorCode.InvalidRequest);
    if(route.endsWith('/discard')){z.object({}).strict().parse(body);await discardTradingSetup(original.store,session!,id);return response({pilotEnabled:true,activation:null,discarded:true});}
    const {asset}=z.object({asset:z.enum(['USDC','NEAR'])}).strict().parse(body);
    await saveTradingPaymentAsset(original.store,session!,id,asset);
    const fresh=await original.store.read(s=>accountFor(s,session)!);
    return response(activationStatus(selectedTradingAccount(fresh,id),deployment.hosted,id));
  }
  if(route==='outlayer/accounts/create') {
    if(!activationPilotEnabled(deployment.hosted))return response({error:'Account creation is unavailable.'},404);
    return response({account:await createTradingAccount(original.store,session!,body)});
  }
  if (route.startsWith("outlayer/activation/")) return runOutlayerActivation(context);
  if (route.startsWith("outlayer/recovery/")) return runOutlayerRecovery(context);
  if (route === "outlayer/quote/preview" || route === "outlayer/quote/prepare") {
    const parsed = z.object({ asset: z.enum(["USDC", "NEAR"]) }).strict().safeParse(body);
    if (!parsed.success) throw new AppError(ErrorCode.InvalidRequest);
    let policy: { walletPublicKey: string; encryptedPolicy: string } | undefined;
    if (route === "outlayer/quote/prepare") {
      if (outlayerSetupView(account).owner !== "verified") return response({ error: "Check your passkey before preparing a real policy quote." }, 409);
      await checkCode();
      try {
        const draft = await prepareSetupDraft(store, session!, account);
        if (draft.phase !== "policy-ready") throw new Error("Policy not ready");
        policy = { walletPublicKey: draft.walletPublicKey, encryptedPolicy: draft.encryptedPolicy };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const category = ["Private session storage is not configured", "Setup encryption is unavailable", "Setup account changed", "Setup ownership changed", "Setup changed", "Wallet registration is unconfirmed", "Setup credential could not be restored", "Policy preparation is unavailable", "Prepared policy wallet does not match", "Wallet storage is temporarily unavailable"].find(prefix => message.startsWith(prefix)) ?? (error instanceof Error && error.name === "ZodError" ? "Provider response validation failed" : "Unexpected preparation failure");
        console.warn("outlayer.policy-preparation.unavailable", { category, errorType: error instanceof Error ? error.name : "unknown" });
        const reason = error instanceof Error && error.message.startsWith("Wallet registration is unconfirmed") ? "Wallet registration is unconfirmed. Setup needs manual review; do not retry." : "Policy preparation is unavailable. No payment has been made; the draft is preserved when possible.";
        return response({ quote: { status: "unavailable", asset: parsed.data.asset, reason } });
      }
    } else if (account.outlayerSetupDraft?.phase === "policy-ready" && account.outlayerSetupDraft.controllerId === ownerPlan(account.publicKey).controllerId && account.outlayerSetupDraft.publicKey === account.publicKey && account.outlayerSetupDraft.credentialId === account.credentialId) {
      policy = { walletPublicKey: account.outlayerSetupDraft.walletPublicKey, encryptedPolicy: account.outlayerSetupDraft.encryptedPolicy };
    }
    const quote = await previewSetupQuote({ asset: parsed.data.asset, publicKey: account.publicKey, identity: accountIdentity(account).accountId, ...(policy ? { policy } : {}) });
    const current = await store.read(s => accountFor(s, session));
    if (!current || current.id !== account.id || current.publicKey !== account.publicKey || current.credentialId !== account.credentialId) throw new AppError(ErrorCode.SessionExpired);
    return response({ quote });
  }
  if (route === "outlayer/owner/prepare") {
    if (Object.keys(body).length) throw new AppError(ErrorCode.InvalidRequest);
    await checkCode();
    const plan = ownerPlan(account.publicKey);
    // Domain separation + nonce + session + exact plan. This is deliberately not
    // a wallet-contract request hash: this proof cannot authorize an on-chain action.
    const payload = JSON.stringify({ purpose: "dya-outlayer-compatibility-v1", network: "mainnet", accountId: account.id, sessionHash: hash(session!), ...plan, nonce: randomBytes(32).toString("hex") });
    const options = await generateAuthenticationOptions({ rpID: deployment.rpId, challenge: createHash("sha256").update(payload).digest("base64url"), userVerification: "required", allowCredentials: [{ id: account.credentialId, transports: account.transports }] });
    const raw = await saveChallenge(store, { value: options.challenge, purpose: "outlayer-owner", expires: Date.now() + 300_000, accountId: account.id, payload, outlayerOwner: { ...plan, publicKey: account.publicKey, credentialId: account.credentialId, sessionHash: hash(session!) } }, ceremony);
    const result = response({ options });
    setCookie(result, CEREMONY, raw, { ...cookieOptions(), maxAge: 300 });
    return result;
  }
  if (route === "outlayer/owner/verify") {
    const c = await consumeChallenge(store, ceremony ?? "", "outlayer-owner");
    const bound = c.outlayerOwner;
    if (!bound || c.accountId !== account.id || bound.sessionHash !== hash(session!) || bound.publicKey !== account.publicKey || bound.credentialId !== account.credentialId) throw new AppError(ErrorCode.InvalidRequest);
    const counter = await verify(account, body as unknown as AuthenticationResponseJSON, c.value);
    await checkCode();
    await store.transaction(s => {
      const a = accountFor(s, session);
      if (!a || a.id !== account.id) throw new AppError(ErrorCode.SessionExpired);
      if (a.publicKey !== bound.publicKey || a.credentialId !== bound.credentialId || a.counter !== account.counter || a.localRecovery || a.providerRecovery?.operation) throw new AppError(ErrorCode.ConcurrentSignatureTryAgain);
      a.counter = counter;
      a.outlayerOwnerCheck = { phase: "verified", credentialId: bound.credentialId, publicKey: bound.publicKey, controllerId: bound.controllerId, codeHash: bound.codeHash, checkedAt: Date.now() };
    });
    const result = response({ setup: await store.read(s => outlayerSetupView(accountFor(s, session)!)) });
    setCookie(result, CEREMONY, "", { ...cookieOptions(), maxAge: 0 });
    return result;
  }
  return response({ error: "Not found" }, 404);
}

function installedSetup(account: Account) {
  const op = account.outlayerActivation;
  return op && (op.phase === "refund" || op.phase === "complete") && op.outcome === "active";
}
