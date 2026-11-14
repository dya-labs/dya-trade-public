import { z } from 'zod';
import type { OwnerRequest } from './owner-request';
const raw=z.string().regex(/^(0|[1-9][0-9]{0,77})$/), text=z.string().min(1).max(65536);
const action=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('init'),stateInitBase64:text,deposit:raw}).strict(),
 z.object({kind:z.literal('transfer'),amount:raw}).strict(),
 z.object({kind:z.literal('call'),method:text,argsBase64:text,gas:raw,deposit:raw}).strict(),
]);
export const setupTransactionSchema=z.object({hash:text,bytes:text,signerId:text,receiverId:text}).strict();
const authorization=z.object({msg:z.custom<OwnerRequest>(v=>!!v&&typeof v==='object'&&'chain_id' in v&&v.chain_id==='mainnet'),proof:text,expiresAt:z.number().int()}).strict();
const work=z.discriminatedUnion('phase',[
 z.object({phase:z.literal('idle')}).strict(),
 z.object({phase:z.literal('preparing'),claimId:text,since:z.number()}).strict(),
 z.object({phase:z.literal('pending'),tx:setupTransactionSchema}).strict(),
]);
const refundRoute=z.object({depositAddress:text,amountIn:raw,minAmountOut:raw,expiresAt:z.number(),appFeeBps:z.number().int().min(0).max(20)}).strict();
const refund=z.discriminatedUnion('phase',[
 z.object({phase:z.literal('needed')}).strict(),
 z.object({phase:z.literal('quoting'),claimId:text,since:z.number()}).strict(),
 z.object({phase:z.literal('quoted'),route:refundRoute}).strict(),
 z.object({phase:z.literal('preparing'),route:refundRoute,claimId:text,since:z.number()}).strict(),
 z.object({phase:z.literal('pending'),route:refundRoute,tx:setupTransactionSchema}).strict(),
 z.object({phase:z.literal('settling'),route:refundRoute,tx:setupTransactionSchema}).strict(),
 z.object({phase:z.literal('owed'),amount:raw,reason:text}).strict(),
]);
export const activationPlanSchema=z.object({
 accountId:text,credentialId:text,publicKey:text,recoveryCredentialId:text.optional(),recoveryPublicKey:text.optional(),
 draftId:text,walletId:text,walletPublicKey:text,controllerId:text,recoveryControllerId:text.optional(),
 codeHash:text,policyContractHash:text,encryptedPolicy:text,policyHash:text,
 policyCall:z.record(z.string(),z.unknown()),policyStorage:raw,controllerReserve:raw,
 gasPriceCap:raw,requiredYoctoNear:raw,payer:text,asset:z.enum(['USDC','NEAR']),sourceAccountId:text,sourceAssetId:text,
 costs:z.object({initializationMax:raw,controllerBalances:raw,policyStorage:raw,gasReserve:raw}).strict(),
 maximumPaymentRaw:raw,expiresAt:z.number().int(),paymentPayload:text,paymentChallenge:text,depositAddress:text,deliveryAppFeeBps:z.number().int().min(0).max(20),
 steps:z.array(z.object({receiverId:text,action}).strict()).min(0).max(3),
}).strict().refine(p => p.recoveryControllerId ? !!p.recoveryCredentialId && !!p.recoveryPublicKey && p.steps.length === 3 : !p.recoveryCredentialId && !p.recoveryPublicKey && p.steps.length <= 1, 'Recovery plan must be complete or deferred');
const base=z.object({id:text,planHash:text,plan:activationPlanSchema,payerSeed:z.string().regex(/^[0-9a-f]{64}$/),createdAt:z.number(),paymentIntentHash:text.optional(),transactions:z.array(setupTransactionSchema),refundedYoctoNear:raw});
export const activationOperationSchema=z.discriminatedUnion('phase',[
 base.extend({phase:z.literal('review')}).strict(),
 base.extend({phase:z.literal('payment-pending'),intentHash:text.optional()}).strict(),
 base.extend({phase:z.literal('payment-review')}).strict(),
 base.extend({phase:z.literal('payment-confirming'),observedAt:z.number().int(),receivedYoctoNear:raw}).strict(),
 base.extend({phase:z.literal('payment-underfunded'),receivedYoctoNear:raw}).strict(),
 base.extend({phase:z.literal('await-owner'),stepIndex:z.number().int().min(0).max(4)}).strict(),
 base.extend({phase:z.literal('running'),stepIndex:z.number().int().min(0).max(4),authorization,work}).strict(),
 base.extend({phase:z.literal('refund'),outcome:z.enum(['active','failed']),retainedControllerYoctoNear:raw,refund}).strict(),
 base.extend({phase:z.literal('complete'),outcome:z.enum(['active','failed']),retainedControllerYoctoNear:raw}).strict(),
 base.extend({phase:z.literal('review-required'),reason:text}).strict(),
]);
export type ActivationOperation=z.infer<typeof activationOperationSchema>;
export type ActivationPlan=z.infer<typeof activationPlanSchema>;
export type SetupTransaction=z.infer<typeof setupTransactionSchema>;
export type RefundRoute=z.infer<typeof refundRoute>;
type Event=
 |{type:'pay';now:number}|{type:'submitted';intentHash:string}|{type:'payment-observed';received:string;now:number}|{type:'payment-failed'}|{type:'payment-shortfall';received:string}|{type:'paid'}|{type:'provider-refunded'}
 |{type:'authorize';authorization:z.infer<typeof authorization>}
 |{type:'claim';id:string;now:number}|{type:'prepared';id:string;tx:SetupTransaction}
 |{type:'step-success'}|{type:'renew-owner'}
 |{type:'refund';outcome:'active'|'failed';retained:string}
 |{type:'refund-claim';id:string;now:number}|{type:'refund-quoted';id:string;route:RefundRoute}
 |{type:'refund-prepare';id:string;now:number}|{type:'refund-prepared';id:string;tx:SetupTransaction}
 |{type:'refund-transfer-failed';amount:string}|{type:'refund-returned';amount:string}|{type:'refund-sent'}|{type:'refund-settled';left:string;amount:string}
 |{type:'refund-owed';amount:string;reason:string}|{type:'retry-refund'}|{type:'review';reason:string};
export function nextActivation(op:ActivationOperation,event:Event):ActivationOperation|undefined {
 const common={id:op.id,planHash:op.planHash,plan:op.plan,payerSeed:op.payerSeed,createdAt:op.createdAt,paymentIntentHash:op.paymentIntentHash,transactions:op.transactions,refundedYoctoNear:op.refundedYoctoNear};
 if(event.type==='review')return {...common,phase:'review-required',reason:event.reason};
 if(op.phase==='review'&&event.type==='pay'&&event.now<op.plan.expiresAt)return {...common,phase:'payment-pending'};
 if(op.phase==='payment-pending'&&event.type==='submitted')return {...op,paymentIntentHash:event.intentHash};
 if(op.phase==='payment-pending'&&event.type==='payment-failed')return {...common,phase:'payment-review'};
 if(['payment-pending','payment-review','payment-confirming'].includes(op.phase)&&event.type==='payment-shortfall')return {...common,phase:'payment-underfunded',receivedYoctoNear:event.received};
 if(['payment-pending','payment-review'].includes(op.phase)&&event.type==='payment-observed')return {...common,phase:'payment-confirming',observedAt:event.now,receivedYoctoNear:event.received};
 if(['payment-pending','payment-review','payment-confirming','payment-underfunded'].includes(op.phase)&&event.type==='paid')return {...common,phase:'await-owner',stepIndex:0};
 if(['payment-pending','payment-review'].includes(op.phase)&&event.type==='provider-refunded')return {...common,phase:'complete',outcome:'failed',retainedControllerYoctoNear:'0'};
 if(op.phase==='await-owner'&&event.type==='authorize')return {...common,phase:'running',stepIndex:op.stepIndex,authorization:event.authorization,work:{phase:'idle'}};
 if(op.phase==='running') {
  if(event.type==='claim'&&(op.work.phase==='idle'||op.work.phase==='preparing'&&event.now-op.work.since>30000))return {...op,work:{phase:'preparing',claimId:event.id,since:event.now}};
  if(event.type==='prepared'&&op.work.phase==='preparing'&&op.work.claimId===event.id)return {...op,work:{phase:'pending',tx:event.tx}};
  if(event.type==='step-success'&&op.work.phase==='pending')return {...op,transactions:[...op.transactions,op.work.tx],stepIndex:op.stepIndex+1,work:{phase:'idle'}};
  if(event.type==='renew-owner'&&op.work.phase!=='pending')return {...common,phase:'await-owner',stepIndex:op.stepIndex};
 }
 if(event.type==='refund'&&['running','await-owner','payment-pending','payment-underfunded'].includes(op.phase))return {...common,phase:'refund',transactions:op.phase==='running'&&op.work.phase==='pending'?[...op.transactions,op.work.tx]:op.transactions,outcome:event.outcome,retainedControllerYoctoNear:event.retained,refund:{phase:'needed'}};
 if(op.phase==='refund') {
  const r=op.refund;
  if(event.type==='refund-transfer-failed'&&r.phase==='pending')return {...op,transactions:[...op.transactions,r.tx],refund:{phase:'owed',amount:event.amount,reason:'Refund transfer failed. Check its finalized receipt before requesting a new refund.'}};
  if(event.type==='refund-returned'&&r.phase==='settling')return {...op,refund:{phase:'owed',amount:event.amount,reason:'Provider returned the refund transfer. Unused NEAR remains claimable.'}};
  if(event.type==='refund-claim'&&(r.phase==='needed'||r.phase==='quoting'&&event.now-r.since>30000))return {...op,refund:{phase:'quoting',claimId:event.id,since:event.now}};
  if(event.type==='refund-quoted'&&r.phase==='quoting'&&r.claimId===event.id)return {...op,refund:{phase:'quoted',route:event.route}};
  if(event.type==='refund-prepare'&&(r.phase==='quoted'||r.phase==='preparing'&&event.now-r.since>30000))return {...op,refund:{phase:'preparing',route:r.route,claimId:event.id,since:event.now}};
  if(event.type==='refund-prepared'&&r.phase==='preparing'&&r.claimId===event.id)return {...op,refund:{phase:'pending',route:r.route,tx:event.tx}};
  if(event.type==='refund-sent'&&r.phase==='pending')return {...op,transactions:[...op.transactions,r.tx],refund:{phase:'settling',route:r.route,tx:r.tx}};
  if(event.type==='refund-owed'&&['needed','quoting','quoted','preparing'].includes(r.phase))return {...op,refund:{phase:'owed',amount:event.amount,reason:event.reason}};
  if(event.type==='retry-refund'&&r.phase==='owed')return {...op,refund:{phase:'needed'}};
  if(event.type==='refund-settled'&&r.phase==='settling') {
   const next={...common,refundedYoctoNear:(BigInt(op.refundedYoctoNear)+BigInt(event.amount)).toString()};
   return event.left==='0'?{...next,phase:'complete',outcome:op.outcome,retainedControllerYoctoNear:op.retainedControllerYoctoNear}:{...op,...next,refund:{phase:'owed',amount:event.left,reason:'Unused NEAR remains claimable; a further refund must cover provider minimums and gas.'}};
  }
 }
 return undefined;
}
export function activationView(op:ActivationOperation) {
 const pending=op.phase==='running'&&op.work.phase==='pending'?op.work.tx:op.phase==='refund'&&op.refund.phase==='pending'?op.refund.tx:undefined;
 return {id:op.id,planHash:op.planHash,phase:op.phase,asset:op.plan.asset,maximumPaymentRaw:op.plan.maximumPaymentRaw,paymentDecimals:op.plan.asset==='USDC'?6:24,requiredYoctoNear:op.plan.requiredYoctoNear,costs:op.plan.costs,controllerId:op.plan.controllerId,recoveryControllerId:op.plan.recoveryControllerId,expiresAt:op.plan.expiresAt,deliveryAppFeeBps:op.plan.deliveryAppFeeBps,
  refundedYoctoNear:op.refundedYoctoNear,txHashes:op.transactions.map(tx=>tx.hash),paymentIntentHash:op.paymentIntentHash,pendingTxHash:pending?.hash,transactionPending:!!pending,
  ...('outcome'in op?{outcome:op.outcome,retainedControllerYoctoNear:op.retainedControllerYoctoNear}:{}),
  ...(op.phase==='running'?{step:op.stepIndex}:{}),
  ...(op.phase==='refund'?{refundPhase:op.refund.phase,...(op.refund.phase==='owed'?{refundOwedYoctoNear:op.refund.amount,reason:op.refund.reason}:{})}:{}),
  ...(op.phase==='review-required'?{reason:op.reason}:{}),
  ...(op.phase==='payment-underfunded'?{receivedYoctoNear:op.receivedYoctoNear}:{}),
 };
}
