/** Read-only local diagnostic; never prints signatures, payloads, keys or seeds. */
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { localConfigPath,localStateRoot } from './local-d1-paths.mjs';
import { D1Store } from '../src/near/repositories/d1-store';
import { StatementBudget } from '../src/near/repositories/request-budget';
import type { D1Client } from '../src/near/repositories/d1-records';
import { checkActivationContracts,verifyActivation } from '../src/near/outlayer/activation-checks';
import { verifyInitialPolicyWrite } from '../src/near/outlayer/policy-write';
import { transactionStatus,nativeBalance } from '../src/near/outlayer/near-transactions';
const proxy=await getPlatformProxy({configPath:localConfigPath,remoteBindings:false,envFiles:[],persist:{path:join(localStateRoot,'v3')}});
try {
 const store=new D1Store(proxy.env.DYA_ID_DB as D1Client,'http://localhost:3101',new StatementBudget('paid'));
 if(process.argv.includes('--drafts')) {
  console.log(JSON.stringify(await store.read(s=>Object.values(s.accounts).flatMap(a=>Object.values(a.outlayerTradingAccounts??{}).map(r=>({id:r.id,name:r.name,lifecycle:r.lifecycle?.phase??'open',paymentAsset:r.paymentAsset??'USDC',draftPhase:r.draft?.phase??'none',activationPhase:r.activation?.phase??'none',savedQuote:!!r.activation,archivedQuotes:Object.keys(r.history??{}).length,quoteExpired:r.activation?Date.now()>=r.activation.plan.expiresAt:undefined})))),null,2));
 } else {
 const ops=await store.read(s=>Object.values(s.accounts).flatMap(a=>a.outlayerActivation?[a.outlayerActivation]:[]));
 for(const op of ops){
  console.log(JSON.stringify({phase:op.phase,transactions:op.transactions.map(t=>t.hash),...('outcome' in op?{outcome:op.outcome}:{}),...(op.phase==='refund'?{refundPhase:op.refund.phase}:{}),refundedYoctoNear:op.refundedYoctoNear}));
  if(op.phase==='refund'&&op.refund.phase==='pending')console.log(JSON.stringify({refundTransactionStatus:await transactionStatus(op.refund.tx.hash,op.refund.tx.signerId)}));
  if('outcome' in op&&op.outcome==='active')console.log(JSON.stringify({onChainVerification:await verifyActivation(op.plan),remainingPayerYoctoNear:await nativeBalance(op.plan.payer)}));
  try {await checkActivationContracts();console.log('Contract pins verified');}catch(e){console.log('Contract check: '+(e instanceof Error?e.message:'failed'));}
  try {verifyInitialPolicyWrite({signature_hex:op.plan.policyCall.wallet_signature,public_key_hex:op.plan.walletPublicKey,version:op.plan.policyCall.version,locked:op.plan.policyCall.locked,valid_until:op.plan.policyCall.valid_until,policy_hash:op.plan.policyHash},{walletPublicKey:op.plan.walletPublicKey,controllerId:op.plan.controllerId,encryptedPolicy:op.plan.encryptedPolicy,policyHash:op.plan.policyHash});console.log('Policy signature verified');}catch(e){console.log('Policy check: '+(e instanceof Error?e.message:'failed'));}
 }
}
}finally{await proxy.dispose();}
