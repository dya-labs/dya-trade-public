import { randomUUID } from 'node:crypto';
import type { StateStore } from '../repositories/store';
import { accountFor } from '../repositories/store';
import { readDepositStatus } from '../services/one-click-deposit';
import { nextActivation,type ActivationOperation,type SetupTransaction,type RefundRoute } from './activation-state';
import { nativeBalance,signSetupTransaction,broadcastSetupTransaction,transactionStatus,type SetupAction } from './near-transactions';
import { checkActivationContracts,verifyActivation } from './activation-checks';
import { prepareSetupRefund } from './setup-refund';
type Event=Parameters<typeof nextActivation>[1];
export async function changeActivation(store:StateStore,session:string,id:string,event:Event) {
 return store.transaction(s=>{
  const a=accountFor(s,session),op=a?.outlayerActivation;
  if(!a||!op||op.id!==id)throw new Error('Setup operation changed or session expired.');
  if (['claim','prepared','authorize','pay'].includes(event.type)) {
   if(a.credentialId!==op.plan.credentialId||a.publicKey!==op.plan.publicKey||(op.plan.recoveryControllerId&&(a.outlayerRecovery?.id!==op.plan.recoveryCredentialId||a.outlayerRecovery?.publicKey!==op.plan.recoveryPublicKey)))throw new Error('Setup authority changed. Reconcile or refund before continuing.');
   if(a.outlayerSetupDraft?.id!==op.plan.draftId||a.outlayerSetupDraft.phase!=='policy-ready'||a.outlayerSetupDraft.walletId!==op.plan.walletId||a.outlayerSetupDraft.policyHash!==op.plan.policyHash)throw new Error('Setup draft changed before execution.');
   if(event.type==='prepared'&&op.phase==='running'&&op.authorization.expiresAt<=Date.now())throw new Error('Setup owner authorization expired before broadcast.');
  }
  const next=nextActivation(op,event);
  if(!next)throw new Error('Setup step has already changed. Refresh its status.');
  a.outlayerActivation=next;return next;
 });
}
export async function currentActivation(store:StateStore,session:string,id?:string) {
 return store.read(s=>{const a=accountFor(s,session),op=a?.outlayerActivation;if(!a||!op||id&&op.id!==id)throw new Error('Setup operation changed or session expired.');return op;});
}
export interface ActivationRuntime {
 balance(account:string):Promise<string>;
 paymentStatus(address:string):ReturnType<typeof readDepositStatus>;
 checkContracts():Promise<unknown>;
 sign(seed:string,receiver:string,action:SetupAction,cap:string):Promise<SetupTransaction>;
 broadcast(bytes:string):Promise<void>;
 status(hash:string,signer:string):Promise<'pending'|'success'|'failed'>;
 verify(plan:ActivationOperation['plan']):ReturnType<typeof verifyActivation>;
 refund(payer:string,recipient:string,amount:string):Promise<RefundRoute>;
}
export function activationRuntime(fetcher:typeof fetch=fetch):ActivationRuntime {
 return {balance:id=>nativeBalance(id,fetcher),paymentStatus:address=>readDepositStatus({depositAddress:address},process.env.ONE_CLICK_JWT??'',fetcher),checkContracts:()=>checkActivationContracts(fetcher),sign:(seed,receiver,action,cap)=>signSetupTransaction(seed,receiver,action,cap,fetcher),broadcast:bytes=>broadcastSetupTransaction(bytes,fetcher),status:(hash,signer)=>transactionStatus(hash,signer,fetcher),verify:plan=>verifyActivation(plan,fetcher),refund:(payer,recipient,amount)=>prepareSetupRefund(payer,recipient,amount,process.env.ONE_CLICK_JWT??'',fetcher)};
}
async function fence(store:StateStore,session:string,op:ActivationOperation) {
 const current=await currentActivation(store,session,op.id);
 if(current.planHash!==op.planHash)throw new Error('Setup terms changed.');
 return current;
}
/** Each call advances one durably fenced effect. GET never calls this runner.
 * Pending submissions are queried, never replaced with a fresh nonce or payment. */
export async function advanceActivation(store:StateStore,session:string,id:string,runtime=activationRuntime(),now=Date.now()) {
 let op=await currentActivation(store,session,id);
 if(op.phase==='payment-pending'||op.phase==='payment-review') {
  const status=await runtime.paymentStatus(op.plan.depositAddress);
  if(status.status==='REFUNDED')return changeActivation(store,session,id,{type:'provider-refunded'});
  if(status.status==='FAILED')return op.phase==='payment-pending'?changeActivation(store,session,id,{type:'payment-failed'}):op;
  if(status.status!=='SUCCESS'||!status.execution)return op;
  if(BigInt(status.execution.inputRaw)>BigInt(op.plan.maximumPaymentRaw)||status.execution.outputRaw!==op.plan.requiredYoctoNear)throw new Error('Settled payment does not match the approved setup.');
  const received=await runtime.balance(op.plan.payer);
  if(BigInt(received)<BigInt(op.plan.requiredYoctoNear))return changeActivation(store,session,id,{type:'payment-observed',received,now});
  return changeActivation(store,session,id,{type:'paid'});
 }
 if(op.phase==='payment-confirming'||op.phase==='payment-underfunded') {
  const received=await runtime.balance(op.plan.payer);
  if(BigInt(received)>=BigInt(op.plan.requiredYoctoNear))return changeActivation(store,session,id,{type:'paid'});
  if(op.phase==='payment-confirming'&&now-op.observedAt>=60000)return changeActivation(store,session,id,{type:'payment-shortfall',received});
  return op;
 }
 if(op.phase==='running') {
  if(op.work.phase==='pending') {
   const status=await runtime.status(op.work.tx.hash,op.work.tx.signerId);
   if(status==='pending')return op;
   if(status==='failed')return changeActivation(store,session,id,{type:'refund',outcome:'failed',retained:await retainedBalance(op,runtime)});
   return changeActivation(store,session,id,{type:'step-success'});
  }
  if(op.stepIndex===op.plan.steps.length+1) {
   const verified=await runtime.verify(op.plan);
   return changeActivation(store,session,id,{type:'refund',outcome:'active',retained:verified.retainedControllerYoctoNear});
  }
  if(op.authorization.expiresAt<=now+15000)return changeActivation(store,session,id,{type:'renew-owner'});
  const claim=randomUUID();
  try {op=await changeActivation(store,session,id,{type:'claim',id:claim,now});} catch{return currentActivation(store,session,id);}
  if(op.phase!=='running')throw new Error('Setup execution changed.');
  await runtime.checkContracts();
  const planned=op.stepIndex<op.plan.steps.length?op.plan.steps[op.stepIndex]:{receiverId:op.plan.controllerId,action:{kind:'call' as const,method:'w_execute_signed',argsBase64:Buffer.from(JSON.stringify({msg:op.authorization.msg,proof:op.authorization.proof})).toString('base64'),gas:'250000000000000',deposit:(BigInt(op.plan.policyStorage)+BigInt(op.plan.controllerReserve)).toString()}};
  const tx=await runtime.sign(op.payerSeed,planned.receiverId,planned.action,op.plan.gasPriceCap);
  if(tx.signerId!==op.plan.payer||tx.receiverId!==planned.receiverId)throw new Error('Setup transaction identity mismatch.');
  op=await changeActivation(store,session,id,{type:'prepared',id:claim,tx});
  await fence(store,session,op);
  try {await runtime.broadcast(tx.bytes);} catch { /* Reconcile the persisted hash. */ }
  return op;
 }
 if(op.phase!=='refund')return op;
 const r=op.refund;
 if(r.phase==='pending') {
  const status=await runtime.status(r.tx.hash,r.tx.signerId);
  if(status==='pending')return op;
  if(status==='failed')return changeActivation(store,session,id,{type:'refund-transfer-failed',amount:await runtime.balance(op.plan.payer)});
  return changeActivation(store,session,id,{type:'refund-sent'});
 }
 if(r.phase==='settling') {
  const status=await runtime.paymentStatus(r.route.depositAddress);
  if(status.status==='REFUNDED')return changeActivation(store,session,id,{type:'refund-returned',amount:await runtime.balance(op.plan.payer)});
  if(status.status!=='SUCCESS'||!status.execution)return op;
  if(status.execution.inputRaw!==r.route.amountIn||BigInt(status.execution.outputRaw)<BigInt(r.route.minAmountOut))throw new Error('Refund settlement differs from its quote.');
  return changeActivation(store,session,id,{type:'refund-settled',left:await runtime.balance(op.plan.payer),amount:status.execution.outputRaw});
 }
 if(r.phase==='owed')return op;
 if(r.phase==='needed'||r.phase==='quoting') {
  const claim=randomUUID();
  try {op=await changeActivation(store,session,id,{type:'refund-claim',id:claim,now});}catch{return currentActivation(store,session,id);}
  const balance=await runtime.balance(op.plan.payer);
  // Retain a bounded native transfer fee reserve. Any tail remains explicitly
  // claimable; never label a partial refund as a full return of funds.
  const feeReserve=BigInt("20000000000000")*BigInt(op.plan.gasPriceCap);
  if(BigInt(balance)<=feeReserve)return changeActivation(store,session,id,{type:'refund-owed',amount:balance,reason:'Unused NEAR is below the refund gas reserve and remains claimable.'});
  try {
   const route=await runtime.refund(op.plan.payer,op.plan.sourceAccountId,(BigInt(balance)-feeReserve).toString());
   return changeActivation(store,session,id,{type:'refund-quoted',id:claim,route});
  }catch{return changeActivation(store,session,id,{type:'refund-owed',amount:balance,reason:'Refund route unavailable or below provider minimums. Unused NEAR remains claimable.'});}
 }
 if(r.phase==='quoted'||r.phase==='preparing') {
  if(r.route.expiresAt<=now+15000)return changeActivation(store,session,id,{type:'refund-owed',amount:await runtime.balance(op.plan.payer),reason:'Refund quote expired. Request a fresh refund; no new transfer was submitted.'});
  const claim=randomUUID();
  try {op=await changeActivation(store,session,id,{type:'refund-prepare',id:claim,now});}catch{return currentActivation(store,session,id);}
  const tx=await runtime.sign(op.payerSeed,r.route.depositAddress,{kind:'transfer',amount:r.route.amountIn},op.plan.gasPriceCap);
  if(tx.signerId!==op.plan.payer||tx.receiverId!==r.route.depositAddress)throw new Error('Refund transaction identity mismatch.');
  op=await changeActivation(store,session,id,{type:'refund-prepared',id:claim,tx});
  await fence(store,session,op);
  try {await runtime.broadcast(tx.bytes);}catch { /* Status polling keeps the exact signed transaction. */ }
  return op;
 }
 return op;
}
async function retainedBalance(op:ActivationOperation,runtime:ActivationRuntime) {
 // A failed initializer may precede account creation. Unknown balances must be
 // checked through the runtime's explicit missing-account result, not zeroed here.
 return (BigInt(await runtime.balance(op.plan.controllerId))+(op.plan.recoveryControllerId?BigInt(await runtime.balance(op.plan.recoveryControllerId)):BigInt(0))).toString();
}
