import { afterEach,expect,test,vi } from 'vitest';
import { createHash,sign } from 'node:crypto';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { activationFixture,deferRecovery } from './outlayer-activation-fixture';
import { runOutlayerActivation,activationPilotEnabled,type ActivationWorkflowDependencies } from '../src/near/services/outlayer-activation-workflow';
import { activationRuntime } from '../src/near/outlayer/activation-runner';
import { nextActivation,activationView,activationOperationSchema } from '../src/near/outlayer/activation-state';
import { accountFor,hash } from '../src/near/repositories/store';
import { verifyAssertion } from '../src/near/auth/passkeys';
import { simulateProbe } from '../src/near/auth/intents';
import { readBalances } from '../src/near/providers/live';
import { getDeploymentConfig } from '../src/deployment/config';
afterEach(()=>vi.unstubAllEnvs());
function fixture() {
 vi.stubEnv('APP_ORIGIN','http://localhost:3101');vi.stubEnv('OUTLAYER_ACTIVATION_PILOT','1');
 const f=activationFixture();
 const deps:ActivationWorkflowDependencies={prepare:vi.fn(async()=>f.op),verify:verifyAssertion,publish:vi.fn(async()=>({intentHash:'1'.repeat(44)})),contracts:vi.fn(async()=>({code_hash:'pin'} as never)),allowed:vi.fn(async()=>{}),runtime:activationRuntime(vi.fn<typeof fetch>().mockRejectedValue(new Error('No live provider in this test')))};
 async function context(route:string,ceremony?:string,body:Record<string,unknown>={}) {
  const account=await f.store.read(s=>accountFor(s,'session')!);
  return {route:`outlayer/activation/${route}`,account,store:f.store,session:'session',ceremony,body,deployment:getDeploymentConfig(),url:new URL('http://localhost:3101/api/near/outlayer'),simulator:simulateProbe,balanceReader:readBalances};
 }
 async function assertion(ceremony:string):Promise<AuthenticationResponseJSON> {
  const c=await f.store.read(s=>s.challenges[hash(ceremony)]);
  const client=Buffer.from(JSON.stringify({type:'webauthn.get',origin:'http://localhost:3101',challenge:c.value,crossOrigin:false}));
  const auth=Buffer.concat([createHash('sha256').update('localhost').digest(),Buffer.from([5,0,0,0,1])]);
  const signature=sign('sha256',Buffer.concat([auth,createHash('sha256').update(client).digest()]),f.main.keys.privateKey);
  return {id:f.main.id,rawId:f.main.id,type:'public-key',clientExtensionResults:{},response:{authenticatorData:auth.toString('base64url'),clientDataJSON:client.toString('base64url'),signature:signature.toString('base64url')}};
 }
 const call=async(route:string,ceremony?:string,body:Record<string,unknown>={})=>(await runOutlayerActivation(await context(route,ceremony,body),deps))!;
 return {...f,deps,context,assertion,call};
}
test('pilot is local-only and disabled without its explicit runtime gate',async()=>{
 const f=fixture();expect(activationPilotEnabled(true)).toBe(false);vi.stubEnv('OUTLAYER_ACTIVATION_PILOT','0');
 expect((await f.call('prepare',undefined,{asset:'USDC'})).status).toBe(404);expect(f.deps.prepare).not.toHaveBeenCalled();
});
test('the exact private payment is passkey-approved once; a lost publish result remains pending across retries',async()=>{
 const f=fixture();vi.mocked(f.deps.publish).mockRejectedValueOnce(new Error('lost response'));
 const options=await f.call('payment-options',undefined,{id:f.op.id}),cookie=options.cookies[0].value,proof=await f.assertion(cookie);
 const result=await f.call('pay',cookie,proof as unknown as Record<string,unknown>);
 expect(result.body).toMatchObject({activation:{phase:'payment-pending',maximumPaymentRaw:'2000000'}});
 expect(f.deps.publish).toHaveBeenCalledTimes(1);
 const signed=vi.mocked(f.deps.publish).mock.calls[0][0];expect(signed.payload).toBe(f.op.plan.paymentPayload);
 await expect(f.call('pay',cookie,proof as unknown as Record<string,unknown>)).rejects.toThrow();expect(f.deps.publish).toHaveBeenCalledTimes(1);
 expect(JSON.stringify(result.body)).not.toContain(f.op.payerSeed);expect(JSON.stringify(result.body)).not.toContain(f.op.plan.paymentPayload);
});
test('an altered source credential during approval prevents the debit',async()=>{
 const f=fixture(),options=await f.call('payment-options',undefined,{id:f.op.id}),cookie=options.cookies[0].value,proof=await f.assertion(cookie);
 f.deps.verify=async(...args)=>{const counter=await verifyAssertion(...args);await f.store.transaction(s=>{s.accounts.a.credentialId='changed';});return counter;};
 await expect(f.call('pay',cookie,proof as unknown as Record<string,unknown>)).rejects.toThrow();expect(f.deps.publish).not.toHaveBeenCalled();
});
test('owner approval authorizes only the planned recovery extension and policy binding after payment',async()=>{
 const f=fixture();const paid=nextActivation(nextActivation(f.op,{type:'pay',now:Date.now()})!,{type:'paid'})!;await f.set(paid);
 const options=await f.call('owner-options',undefined,{id:f.op.id}),cookie=options.cookies[0].value;
 const c=await f.store.read(s=>s.challenges[hash(cookie)]);
 expect(c.outlayerActivation?.ownerRequest?.request.internal).toEqual([{op:'add_extension',payload:{account_id:f.op.plan.recoveryControllerId}}]);
 const result=await f.call('owner-verify',cookie,await f.assertion(cookie) as unknown as Record<string,unknown>);
 expect(result.body).toMatchObject({activation:{phase:'running',step:0}});expect(f.deps.publish).not.toHaveBeenCalled();
 const current=await f.store.read(s=>s.accounts.a.outlayerActivation!);expect(current.phase).toBe('running');if(current.phase==='running')expect(JSON.parse(current.authorization.proof).signature).toMatch(/^p256:/);
});
test('arbitrary client payment or payer fields cannot enter the executable plan',async()=>{
 const f=fixture();await expect(f.call('prepare',undefined,{asset:'USDC',payer:'attacker.near'})).rejects.toThrow();expect(f.deps.prepare).not.toHaveBeenCalled();
});
test('changing the stored maximum after a review invalidates its plan binding',async()=>{
 const f=fixture();await f.store.transaction(s=>{s.accounts.a.outlayerActivation!.plan.maximumPaymentRaw='1';});
 await expect(f.call('payment-options',undefined,{id:f.op.id})).rejects.toThrow();expect(f.deps.publish).not.toHaveBeenCalled();
});
test('public operation status contains no operational credential, private payment or raw signature',()=>{
 const f=activationFixture();const view=activationView(f.op),data=JSON.stringify(view);
 for(const secret of [f.op.payerSeed,f.op.plan.paymentPayload,f.op.plan.paymentChallenge,String(f.op.plan.policyCall.wallet_signature)])expect(data).not.toContain(secret);
});

test('single-passkey activation authorizes policy installation without enrolling recovery', async () => {
 const f=fixture();await deferRecovery(f);
 await f.set(nextActivation(nextActivation(f.op,{type:'pay',now:Date.now()})!,{type:'paid'})!);
 const options=await f.call('owner-options',undefined,{id:f.op.id}),cookie=options.cookies[0].value;
 const challenge=await f.store.read(s=>s.challenges[hash(cookie)]);
 expect(challenge.outlayerActivation?.ownerRequest?.request.internal).toEqual([]);
 const result=await f.call('owner-verify',cookie,await f.assertion(cookie) as unknown as Record<string,unknown>);
 expect(result.body).toMatchObject({activation:{phase:'running',step:0}});
 expect(await f.store.read(s=>s.accounts.a.outlayerRecovery)).toBeUndefined();
 expect(f.deps.publish).not.toHaveBeenCalled();
});

test('session metadata lists verified active Trading accounts while excluding drafts, failed setup and authority changes', async () => {
 const {sessionSnapshot}=await import('../src/near/services/workflow-context');
 const f=fixture();await deferRecovery(f);
 expect(sessionSnapshot(await f.store.read(s=>s.accounts.a), true).account?.tradingWallet).toBeUndefined();
 await f.set(activationOperationSchema.parse({...f.op,phase:'refund',outcome:'active',retainedControllerYoctoNear:'7700000000000000000000',refund:{phase:'owed',amount:'1',reason:'Claimable'}}));
 const account=await f.store.read(s=>s.accounts.a),snapshot=sessionSnapshot(account, true);
 expect(snapshot.account?.tradingWallet).toEqual({id:f.op.plan.walletId,name:"Main",controllerId:f.op.plan.controllerId,recoveryInstalled:false});
 expect(JSON.stringify(snapshot)).not.toContain(f.op.payerSeed);
 expect(sessionSnapshot({...account,credentialId:'changed'}, true).account?.tradingWallet).toBeUndefined();
 await f.set(activationOperationSchema.parse({...f.op,phase:'complete',outcome:'failed',retainedControllerYoctoNear:'0'}));
 expect(sessionSnapshot(await f.store.read(s=>s.accounts.a), true).account?.tradingWallet).toBeUndefined();
});

test('a passkey payment updates only the selected wallet journal and never the original account',async()=>{
 const {tradingAccountStore,selectedTradingAccount}=await import('../src/near/outlayer/accounts');
 const f=fixture(),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 await f.store.transaction(s=>{s.accounts.a.outlayerTradingAccounts={[id]:{id,name:'Strategy',createdAt:Date.now()}};});
 const draft=await f.store.read(s=>s.accounts.a.outlayerSetupDraft);
 const scoped=tradingAccountStore(f.store,'a',id);
 await scoped.transaction(s=>{s.accounts.a.outlayerSetupDraft=structuredClone(draft);s.accounts.a.outlayerActivation={...f.op,id};});
 async function call(route:string,ceremony?:string,body:Record<string,unknown>={}){
  const context=await f.context(route,ceremony,body);
  return (await runOutlayerActivation({...context,store:scoped,account:selectedTradingAccount(context.account,id)},f.deps))!;
 }
 const options=await call('payment-options',undefined,{id}),cookie=options.cookies[0].value;
 const result=await call('pay',cookie,await f.assertion(cookie) as unknown as Record<string,unknown>);
 expect(result.body).toMatchObject({activation:{id,phase:'payment-pending'}});
 expect(f.deps.publish).toHaveBeenCalledTimes(1);
 const account=await f.store.read(s=>s.accounts.a);
 expect(account.outlayerActivation?.phase).toBe('review');
 expect(account.outlayerTradingAccounts?.[id].activation?.phase).toBe('payment-pending');
});
