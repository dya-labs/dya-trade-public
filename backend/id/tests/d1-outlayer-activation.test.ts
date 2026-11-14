import { expect,test,vi } from 'vitest';
import { activationFixture,deferRecovery } from './outlayer-activation-fixture';
import { nextActivation,activationView,activationOperationSchema } from '../src/near/outlayer/activation-state';
import { advanceActivation,changeActivation,currentActivation,type ActivationRuntime } from '../src/near/outlayer/activation-runner';
import { ownerRequest } from '../src/near/outlayer/owner-request';
function paid(f:ReturnType<typeof activationFixture>){return nextActivation(nextActivation(f.op,{type:'pay',now:Date.now()})!,{type:'paid'})!;}
function authorized(f:ReturnType<typeof activationFixture>){return nextActivation(paid(f),{type:'authorize',authorization:{msg:ownerRequest(f.op.plan.controllerId,f.op.plan.recoveryControllerId,f.op.plan.policyCall,f.op.plan.policyStorage),proof:'synthetic-owner-proof',expiresAt:Date.now()+300000}})!;}
function runtime(f:ReturnType<typeof activationFixture>) {
 let number=0,refundAmount='0';const balance='950000000000000000000000';
 const status=(input:string,output:string)=>({status:'SUCCESS' as const,terminal:true,creditedAmount:undefined,updatedAt:new Date().toISOString(),execution:{inputRaw:input,outputRaw:output,inputAmount:'2',outputAmount:'1',settledAt:Date.now()},originChainTxHashes:[],destinationChainTxHashes:['native-transfer'],nearTxHashes:[]});
 const r:ActivationRuntime={balance:vi.fn(async id=>id===f.op.plan.payer?balance:'100'),paymentStatus:vi.fn(async address=>address==='payment-deposit.near'?status('2000000',f.op.plan.requiredYoctoNear):status(refundAmount,refundAmount)),checkContracts:vi.fn(async()=>{}),sign:vi.fn(async (_seed,receiver)=>({hash:`tx-${++number}`,bytes:`signed-${number}`,signerId:f.op.plan.payer,receiverId:receiver})),broadcast:vi.fn(async()=>{}),status:vi.fn(async()=> 'success' as const),verify:vi.fn(async()=>({policyVersion:1 as const,recoveryInstalled:true as const,retainedControllerYoctoNear:'200'})),refund:vi.fn(async(_payer,_source,amount)=>{refundAmount=amount;return {depositAddress:'refund.near',amountIn:amount,minAmountOut:amount,expiresAt:Date.now()+60000,appFeeBps:20};})};
 return r;
}
test('expired or duplicated payment authorization never starts another debit',()=>{
 const f=activationFixture();expect(nextActivation(f.op,{type:'pay',now:f.op.plan.expiresAt})).toBeUndefined();
 const pending=nextActivation(f.op,{type:'pay',now:Date.now()})!;
 expect(nextActivation(pending,{type:'pay',now:Date.now()})).toBeUndefined();
 expect(nextActivation(pending,{type:'authorize',authorization:{msg:ownerRequest(f.op.plan.controllerId,f.op.plan.recoveryControllerId,f.op.plan.policyCall,'1'),proof:'x',expiresAt:1}})).toBeUndefined();
});
test('a lost transaction response is reconciled by its persisted hash without another sign or broadcast',async()=>{
 const f=activationFixture(),r=runtime(f);await f.set(authorized(f));
 vi.mocked(r.broadcast).mockRejectedValueOnce(new Error('lost response'));vi.mocked(r.status).mockResolvedValue('pending');
 await advanceActivation(f.store,'session',f.op.id,r);
 for(let i=0;i<3;i++)await advanceActivation(f.store,'session',f.op.id,r);
 expect(r.sign).toHaveBeenCalledTimes(1);expect(r.broadcast).toHaveBeenCalledTimes(1);
 const op=await currentActivation(f.store,'session');expect(op.phase).toBe('running');if(op.phase==='running')expect(op.work.phase).toBe('pending');
});
test('concurrent callers cannot prepare or broadcast two transactions',async()=>{
 const f=activationFixture(),r=runtime(f);await f.set(authorized(f));
 await Promise.all([advanceActivation(f.store,'session',f.op.id,r),advanceActivation(f.store,'session',f.op.id,r)]);
 expect(r.sign).toHaveBeenCalledTimes(1);expect(r.broadcast).toHaveBeenCalledTimes(1);
});
test('logout while signing prevents transaction checkpoint and broadcast',async()=>{
 const f=activationFixture(),r=runtime(f);await f.set(authorized(f));
 const original=r.sign;r.sign=async(...args)=>{const tx=await original(...args);await f.store.transaction(s=>{s.sessions={};});return tx;};
 await expect(advanceActivation(f.store,'session',f.op.id,r)).rejects.toThrow('session expired');expect(r.broadcast).not.toHaveBeenCalled();
});
test('a stale preparation lease cannot commit after another claim replaces it',()=>{
 const f=activationFixture(),op=authorized(f),first=nextActivation(op,{type:'claim',id:'first',now:1000})!,second=nextActivation(first,{type:'claim',id:'second',now:32000})!;
 const tx={hash:'h',bytes:'signed',signerId:f.op.plan.payer,receiverId:'receiver.near'};
 expect(nextActivation(second,{type:'prepared',id:'first',tx})).toBeUndefined();expect(nextActivation(second,{type:'prepared',id:'second',tx})?.phase).toBe('running');
});
test('all finalized setup steps and ownership/recovery verification precede an active result; partial refunds stay claimable',async()=>{
 const f=activationFixture(),r=runtime(f);await f.set(authorized(f));
 for(let i=0;i<8;i++)await advanceActivation(f.store,'session',f.op.id,r);
 expect(r.verify).not.toHaveBeenCalled();
 await advanceActivation(f.store,'session',f.op.id,r);expect(r.verify).toHaveBeenCalledTimes(1);
 let op=await currentActivation(f.store,'session');expect(op.phase).toBe('refund');expect(activationView(op).outcome).toBe('active');
 for(let i=0;i<5;i++)await advanceActivation(f.store,'session',f.op.id,r);
 op=await currentActivation(f.store,'session');expect(op.phase).toBe('refund');if(op.phase==='refund')expect(op.refund.phase).toBe('owed');
 expect(BigInt(op.refundedYoctoNear)).toBeGreaterThan(0n);expect(activationView(op)).not.toHaveProperty('payerSeed');
});
test('a failed initializer never claims activation and returns the remaining payer funds',async()=>{
 const f=activationFixture(),r=runtime(f);await f.set(authorized(f));vi.mocked(r.status).mockResolvedValue('failed');
 await advanceActivation(f.store,'session',f.op.id,r);const op=await advanceActivation(f.store,'session',f.op.id,r);
 expect(op.phase).toBe('refund');expect(activationView(op).outcome).toBe('failed');expect(r.verify).not.toHaveBeenCalled();
});
test('payment settlement must match its approved debit/output and actually fund the isolated payer',async()=>{
 const f=activationFixture(),r=runtime(f);await f.set(nextActivation(f.op,{type:'pay',now:Date.now()})!);
 expect((await advanceActivation(f.store,'session',f.op.id,r)).phase).toBe('payment-confirming');
 expect((await advanceActivation(f.store,'session',f.op.id,r,Date.now()+61000)).phase).toBe('payment-underfunded');expect(r.sign).not.toHaveBeenCalled();
 await f.set(nextActivation(f.op,{type:'pay',now:Date.now()})!);
 vi.mocked(r.balance).mockResolvedValue(f.op.plan.requiredYoctoNear);
 expect((await advanceActivation(f.store,'session',f.op.id,r)).phase).toBe('await-owner');
});
test('expired owner authorization requires a fresh proof without charging again',async()=>{
 const f=activationFixture(),r=runtime(f),op=authorized(f);if(op.phase!=='running')throw new Error();op.authorization.expiresAt=1;await f.set(op);
 expect((await advanceActivation(f.store,'session',f.op.id,r)).phase).toBe('await-owner');expect(r.sign).not.toHaveBeenCalled();
});
test('private setup record is strict and survives encrypted local D1 reload without exposing its payer seed or payment payload',async()=>{
 const {harness,origin}=await import('./d1-harness'),{D1Store}=await import('../src/near/repositories/d1-store'),{StatementBudget}=await import('../src/near/repositories/request-budget');
 const h=await harness();try{
  const f=activationFixture(),seed=await f.store.read(s=>s),store=new D1Store(h.db,origin,new StatementBudget('paid'));
  await store.transaction(s=>{s.accounts=seed.accounts;s.sessions=seed.sessions;});
  const raw=await h.raw.prepare('SELECT data FROM id_accounts WHERE id=?').bind('a').first<{data:string}>();expect(raw?.data).not.toContain(f.op.payerSeed);expect(raw?.data).not.toContain(f.op.plan.paymentPayload);
  const restored=await new D1Store(h.db,origin,new StatementBudget('paid')).read(s=>s.accounts.a.outlayerActivation);
  expect(restored).toEqual(f.op);expect(activationOperationSchema.safeParse({...f.op,phase:'running'}).success).toBe(false);
 }finally{await h.mf.dispose();}
});

test('single-passkey setup executes only initialization and policy installation, then verifies before activation', async () => {
 const f=await deferRecovery(activationFixture()),r=runtime(f);
 const msg=ownerRequest(f.op.plan.controllerId,undefined,f.op.plan.policyCall,f.op.plan.policyStorage);
 expect(msg.request.internal).toEqual([]);
 await f.set(authorized(f));
 for(let i=0;i<4;i++)await advanceActivation(f.store,'session',f.op.id,r);
 expect(r.verify).not.toHaveBeenCalled();
 expect(r.sign).toHaveBeenCalledTimes(2);
 expect(vi.mocked(r.sign).mock.calls.map(c=>c[1])).toEqual([f.op.plan.controllerId,f.op.plan.controllerId]);
 const result=await advanceActivation(f.store,'session',f.op.id,r);
 expect(result.phase).toBe('refund');expect(activationView(result).outcome).toBe('active');
 expect(r.verify).toHaveBeenCalledExactlyOnceWith(f.op.plan);
});
