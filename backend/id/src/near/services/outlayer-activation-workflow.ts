import { setupMetadata,canDiscardSetup } from "../outlayer/accounts";
import { DYA_WALLET_NAMES } from "@dya/config";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";
import { createSetupPayer } from "../outlayer/near-transactions";
import { StorageUnavailableError } from "../repositories/storage-error";
import { ConfidentialAccessRequired } from "../../../../../packages/wallet-contracts/src/domain/confidential-access-error";
import { RateLimitError } from "../../../../../packages/wallet-contracts/src/domain/rate-limit";
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { generateAuthenticationOptions,type AuthenticationResponseJSON } from '@simplewebauthn/server';
import { AppError,ErrorCode } from '../../../../../packages/wallet-contracts/src/domain/errors';
import { ASSETS,balanceFor } from '../../../../../packages/wallet-contracts/src/domain/assets';
import { validatePrivateTransfer } from '../../../../../packages/wallet-contracts/src/domain/confidential';
import { accountFor,consumeChallenge,hash,type Account,type StateStore } from '../repositories/store';
import { accountIdentity,encodeAssertion } from '../auth/intents';
import { verifyAssertion } from '../auth/passkeys';
import { prepareActivation } from '../outlayer/activation-plan';
import { activationView,nextActivation,type ActivationOperation } from '../outlayer/activation-state';
import { changeActivation,currentActivation,advanceActivation,activationRuntime,type ActivationRuntime } from '../outlayer/activation-runner';
import { ownerRequest,ownerRequestHash,ownerProof } from '../outlayer/owner-request';
import { checkActivationContracts } from '../outlayer/activation-checks';
import { verifyInitialPolicyWrite } from '../outlayer/policy-write';
import { publishWithdrawal } from './one-click-withdraw';
import { requireToken } from './token-policy';
import { requireNetwork } from './network-policy';
import { readCatalog } from '../providers/catalog';
import { CEREMONY,cookieOptions,response,saveChallenge,setCookie,type AccountWorkflowContext } from './workflow-context';

export function activationPilotEnabled(hosted:boolean) {return !hosted&&process.env.OUTLAYER_ACTIVATION_PILOT==='1';}
export function activationStatus(account:Account,hosted:boolean,selectionId?:string|null) {
 const enabled=activationPilotEnabled(hosted);
 if(enabled&&!account.outlayerActivation)createSetupPayer('00000000-0000-0000-0000-000000000000');
 return {...setupMetadata(account,selectionId),pilotEnabled:enabled,activation:account.outlayerActivation?activationView(account.outlayerActivation):null};
}
function sameOwner(account:Account,op:ActivationOperation) {
 if(account.id!==op.plan.accountId||account.credentialId!==op.plan.credentialId||account.publicKey!==op.plan.publicKey||(op.plan.recoveryControllerId&&(account.outlayerRecovery?.id!==op.plan.recoveryCredentialId||account.outlayerRecovery?.publicKey!==op.plan.recoveryPublicKey))||accountIdentity(account).accountId!==op.plan.sourceAccountId)throw new AppError(ErrorCode.WalletChanged);
 if(account.outlayerSetupDraft?.id!==op.plan.draftId||account.outlayerSetupDraft.phase!=='policy-ready'||account.outlayerSetupDraft.walletId!==op.plan.walletId||account.outlayerSetupDraft.walletPublicKey!==op.plan.walletPublicKey||account.outlayerSetupDraft.policyHash!==op.plan.policyHash)throw new AppError(ErrorCode.WalletChanged);
 if(createHash('sha256').update(JSON.stringify(op.plan)).digest('hex')!==op.planHash)throw new AppError(ErrorCode.InvalidRequest);
}
async function allowedPayment(store:StateStore,sourceId:string) {
 const catalog=await readCatalog(),source=catalog.find(t=>t.assetId===sourceId),near=catalog.find(t=>t.assetId==='nep141:wrap.near');
 if(!source||!near)throw new AppError(ErrorCode.TokenOperationUnavailable);
 await store.read(s=>{requireToken(s,source,'withdrawals');requireToken(s,near,'deposits');requireNetwork(s,'near','withdrawals');requireNetwork(s,'near','deposits');});
}
export interface ActivationWorkflowDependencies {
 prepare:typeof prepareActivation; verify:typeof verifyAssertion; publish:typeof publishWithdrawal;
 contracts:typeof checkActivationContracts; allowed:typeof allowedPayment; runtime:ActivationRuntime;
}
const defaults=():ActivationWorkflowDependencies=>({prepare:prepareActivation,verify:verifyAssertion,publish:publishWithdrawal,contracts:checkActivationContracts,allowed:allowedPayment,runtime:activationRuntime()});
async function runActivation(context:AccountWorkflowContext,deps:ActivationWorkflowDependencies) {
 const {route,store,session,account,body,deployment}=context;
 if(!route.startsWith('outlayer/activation/'))return null;
 if(!activationPilotEnabled(deployment.hosted))return response({error:'Activation pilot is disabled.'},404);
 const answer=(op:ActivationOperation)=>response({...setupMetadata(account,context.url.searchParams.get('account')),canDiscard:canDiscardSetup({activation:op,draft:account.outlayerSetupDraft,history:account.outlayerActivationHistory}),pilotEnabled:true,activation:activationView(op)});
 if(route==='outlayer/activation/prepare') {
  const {asset}=z.object({asset:z.enum(['USDC','NEAR'])}).strict().parse(body);
  if(!account.publicKey||!account.credentialId||account.outlayerOwnerCheck?.publicKey!==account.publicKey)throw new AppError(ErrorCode.InvalidRequest);
  const existing=account.outlayerActivation;
  if(existing&&(existing.phase!=='review'||!existing.plan.recoveryControllerId&&existing.plan.asset===asset&&existing.plan.expiresAt>Date.now()))return answer(existing);
  const op=await deps.prepare(account,asset);
  await deps.allowed(store,op.plan.sourceAssetId);
  const balances=await context.balanceReader(op.plan.sourceAccountId,undefined,ASSETS);
  if(BigInt(balanceFor(balances,op.plan.sourceAssetId).raw)<BigInt(op.plan.maximumPaymentRaw))return response({error:`Insufficient ${asset}. Setup requires up to ${new D(op.plan.maximumPaymentRaw).div(new D(10).pow(asset === "USDC" ? 6 : 24)).toFixed()} ${asset}. Add funds to ${DYA_WALLET_NAMES.main} or select another token. No payment was made.`,maximumPaymentRaw:op.plan.maximumPaymentRaw,asset},409);
  const saved=await store.transaction(s=>{
   const a=accountFor(s,session);if(!a)throw new AppError(ErrorCode.SessionExpired);sameOwner(a,op);
   const current=a.outlayerActivation;
   if(current&&(current.phase!=='review'||!current.plan.recoveryControllerId&&current.plan.asset===asset&&current.plan.expiresAt>Date.now()))return current;
   // Keep expired unsigned reviews for recovery of any externally submitted payment.
   if(current){a.outlayerActivationHistory??={};if(Object.keys(a.outlayerActivationHistory).length>=10)throw new AppError(ErrorCode.InvalidRequest);a.outlayerActivationHistory[current.id]=current;}
   a.outlayerActivation=op;return op;
  });
  return answer(saved);
 }
 const assertionRoute=route.endsWith('/pay')||route.endsWith('/owner-verify');
 const id=assertionRoute?undefined:z.object({id:z.string().uuid()}).strict().parse(body).id;
 let op=await currentActivation(store,session!,id);
 if (!['outlayer/activation/advance','outlayer/activation/refund'].includes(route)) sameOwner(account,op);
 else if(account.id!==op.plan.accountId||accountIdentity(account).accountId!==op.plan.sourceAccountId)throw new AppError(ErrorCode.WalletChanged);
 if(route==='outlayer/activation/payment-options') {
  if(op.phase!=='review'||op.plan.expiresAt<=Date.now())throw new AppError(ErrorCode.InvalidRequest);
  await deps.allowed(store,op.plan.sourceAssetId);await deps.contracts();
  const options=await generateAuthenticationOptions({rpID:deployment.rpId,challenge:Buffer.from(op.plan.paymentChallenge,'base64url'),userVerification:'required',allowCredentials:[{id:account.credentialId!,transports:account.transports}]});
  const raw=await saveChallenge(store,{purpose:'outlayer-payment',value:options.challenge,expires:op.plan.expiresAt,accountId:account.id,outlayerActivation:{id:op.id,planHash:op.planHash,sessionHash:hash(session!)}},context.ceremony,context.bind);
  const result=response({options});setCookie(result,CEREMONY,raw,{...cookieOptions(),maxAge:Math.max(1,Math.floor((op.plan.expiresAt-Date.now())/1000))});return result;
 }
 if(route==='outlayer/activation/pay'||route==='outlayer/activation/owner-verify') {
  const purpose=route.endsWith('/pay')?'outlayer-payment':'outlayer-activation-owner';
  const c=await consumeChallenge(store,context.ceremony??'',purpose),binding=c.outlayerActivation;
  if(c.accountId!==account.id||!binding||binding.id!==op.id||binding.planHash!==op.planHash||binding.sessionHash!==hash(session!))throw new AppError(ErrorCode.InvalidRequest);
  const assertion=body as unknown as AuthenticationResponseJSON;
  const counter=await deps.verify(account,assertion,c.value);
  if(purpose==='outlayer-payment') {
   if(op.phase!=='review')throw new AppError(ErrorCode.InvalidRequest);
   const parsed=JSON.parse(op.plan.paymentPayload) as Record<string,unknown>;
   if(parsed.signer_id!==op.plan.sourceAccountId||Date.parse(String(parsed.deadline))<=Date.now())throw new AppError(ErrorCode.InvalidRequest);
   validatePrivateTransfer(parsed,op.plan.depositAddress,op.plan.sourceAssetId,op.plan.maximumPaymentRaw);
   await deps.allowed(store,op.plan.sourceAssetId);await deps.contracts();
   const signed=encodeAssertion(accountIdentity(account),op.plan.paymentPayload,assertion);
   op=await store.transaction(s=>{const a=accountFor(s,session);if(!a||a.counter!==account.counter)throw new AppError(ErrorCode.ConcurrentSignatureTryAgain);sameOwner(a,op);const current=a.outlayerActivation;if(!current||current.id!==op.id)throw new AppError(ErrorCode.InvalidRequest);const next=nextActivation(current,{type:'pay',now:Date.now()});if(!next)throw new AppError(ErrorCode.InvalidRequest);a.counter=counter;a.outlayerActivation=next;return next;});
   try {const result=await deps.publish(signed,process.env.ONE_CLICK_JWT??'');op=await changeActivation(store,session!,op.id,{type:'submitted',intentHash:result.intentHash});}catch{/* The durable payment-pending record is reconciled by deposit address. */}
  }else{
   if(op.phase!=='await-owner'||!binding.ownerRequest||ownerRequestHash(binding.ownerRequest).toString('base64url')!==c.value)throw new AppError(ErrorCode.InvalidRequest);
   const msg=binding.ownerRequest,expiresAt=Date.parse(msg.created_at)+msg.timeout_secs*1000;
   if(expiresAt<=Date.now()+15000)throw new AppError(ErrorCode.InvalidRequest);
   op=await store.transaction(s=>{const a=accountFor(s,session);if(!a||a.counter!==account.counter)throw new AppError(ErrorCode.ConcurrentSignatureTryAgain);sameOwner(a,op);const current=a.outlayerActivation;if(!current||current.id!==op.id)throw new AppError(ErrorCode.InvalidRequest);const next=nextActivation(current,{type:'authorize',authorization:{msg,proof:ownerProof(assertion),expiresAt}});if(!next)throw new AppError(ErrorCode.InvalidRequest);a.counter=counter;a.outlayerActivation=next;return next;});
  }
  const result=answer(op);setCookie(result,CEREMONY,'',{...cookieOptions(),maxAge:0});return result;
 }
 if(route==='outlayer/activation/owner-options') {
  if(op.phase!=='await-owner')throw new AppError(ErrorCode.InvalidRequest);
  await deps.contracts();
  verifyInitialPolicyWrite({signature_hex:op.plan.policyCall.wallet_signature,public_key_hex:op.plan.walletPublicKey,version:op.plan.policyCall.version,locked:op.plan.policyCall.locked,valid_until:op.plan.policyCall.valid_until,policy_hash:op.plan.policyHash},{walletPublicKey:op.plan.walletPublicKey,controllerId:op.plan.controllerId,encryptedPolicy:op.plan.encryptedPolicy,policyHash:op.plan.policyHash});
  const msg=ownerRequest(op.plan.controllerId,op.plan.recoveryControllerId,op.plan.policyCall,op.plan.policyStorage);
  const options=await generateAuthenticationOptions({rpID:deployment.rpId,challenge:ownerRequestHash(msg),userVerification:'required',allowCredentials:[{id:account.credentialId!,transports:account.transports}]});
  const raw=await saveChallenge(store,{purpose:'outlayer-activation-owner',value:options.challenge,expires:Date.now()+300000,accountId:account.id,outlayerActivation:{id:op.id,planHash:op.planHash,sessionHash:hash(session!),ownerRequest:msg}},context.ceremony,context.bind);
  const result=response({options});setCookie(result,CEREMONY,raw,{...cookieOptions(),maxAge:300});return result;
 }
 if(route==='outlayer/activation/advance')return answer(await advanceActivation(store,session!,op.id,deps.runtime));
 if(route==='outlayer/activation/refund') {
  if(op.phase==='refund')return answer(await changeActivation(store,session!,op.id,{type:'retry-refund'}));
  if(op.phase!=='await-owner'&&op.phase!=='payment-underfunded'&&!(op.phase==='running'&&op.work.phase!=='pending'))throw new AppError(ErrorCode.InvalidRequest);
  const retained=(BigInt(await deps.runtime.balance(op.plan.controllerId))+(op.plan.recoveryControllerId?BigInt(await deps.runtime.balance(op.plan.recoveryControllerId)):BigInt(0))).toString();
  return answer(await changeActivation(store,session!,op.id,{type:'refund',outcome:'failed',retained}));
 }
 if(route==='outlayer/activation/rebroadcast') {
  const tx=op.phase==='running'&&op.work.phase==='pending'?op.work.tx:op.phase==='refund'&&op.refund.phase==='pending'?op.refund.tx:undefined;
  if(!tx)throw new AppError(ErrorCode.InvalidRequest);
  // Explicit retry sends the identical signed bytes and nonce, never a replacement.
  try {await deps.runtime.broadcast(tx.bytes);}catch{/* Unknown remains pending. */}
  return answer(op);
 }
 return response({error:'Not found'},404);
}

export async function runOutlayerActivation(context:AccountWorkflowContext,deps=defaults()) {
 try { return await runActivation(context,deps); }
 catch(error) {
  if(error instanceof z.ZodError)throw new AppError(ErrorCode.InvalidRequest);
  if(error instanceof AppError||error instanceof StorageUnavailableError||error instanceof ConfidentialAccessRequired||error instanceof RateLimitError)throw error;
  console.warn('outlayer.activation.unavailable',{category:error instanceof Error?error.name:'unknown'});
  return response({error:'Setup action is unavailable. Refresh its status before retrying; do not make a replacement payment.'},503);
 }
}
