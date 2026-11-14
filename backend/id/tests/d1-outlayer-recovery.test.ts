import { afterEach, expect, test, vi } from 'vitest';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { verifyRegistrationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import { emptyState, hash, type StateStore } from '../src/near/repositories/store';
import { getDeploymentConfig } from '../src/deployment/config';
import { simulateProbe } from '../src/near/auth/intents';
import { readBalances } from '../src/near/providers/live';
import { runOutlayerRecovery } from '../src/near/services/outlayer-recovery-workflow';
import { verifyAssertion } from '../src/near/auth/passkeys';
import { nextRecoveryEnrollment } from '../src/near/outlayer/recovery';
import { readImmutableOwnerCode } from '../src/near/outlayer/owner';
import { nextSetup, setupPresentation, type SetupState } from '../../../frontend/id/components/trading-setup-machine';
afterEach(()=>vi.unstubAllEnvs());
function key(id:string) {
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'});
 const bytes=Buffer.from(isoCBOR.encode(new Map<number,number|Uint8Array>([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x!,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y!,'base64url'))]])));
 return {id,pair,bytes,publicKey:bytes.toString('base64url')};
}
function fixture() {
 vi.stubEnv('APP_ORIGIN','http://localhost:3101');
 const primary=key('cHJpbWFyeQ'),backup=key('YmFja3Vw');let state=emptyState();
 state.accounts.a={id:'a',kind:'passkey',credentialId:primary.id,publicKey:primary.publicKey,counter:0};
 state.sessions[hash('session')]={accountId:'a',expires:Date.now()+60000};
 const store:StateStore={read:fn=>fn(structuredClone(state)),transaction:fn=>{const next=structuredClone(state);const result=fn(next);state=next;return result;}};
 const context=(route:string,ceremony?:string,body:Record<string,unknown>={})=>({route:`outlayer/recovery/${route}`,ceremony,body,store,account:structuredClone(state.accounts.a),session:'session',deployment:getDeploymentConfig(),url:new URL('http://localhost:3101/api/near/outlayer'),simulator:simulateProbe,balanceReader:readBalances});
 const register=vi.fn<typeof verifyRegistrationResponse>().mockResolvedValue({verified:true,registrationInfo:{credential:{id:backup.id,publicKey:new Uint8Array(backup.bytes),counter:0}}} as Awaited<ReturnType<typeof verifyRegistrationResponse>>);
 function assertion(k:ReturnType<typeof key>,ceremony:string) {
  const client=Buffer.from(JSON.stringify({type:'webauthn.get',origin:'http://localhost:3101',challenge:state.challenges[hash(ceremony)].value,crossOrigin:false}));
  const auth=Buffer.concat([createHash('sha256').update('localhost').digest(),Buffer.from([5,0,0,0,1])]);
  const signature=sign('sha256',Buffer.concat([auth,createHash('sha256').update(client).digest()]),k.pair.privateKey);
  return {id:k.id,rawId:k.id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:client.toString('base64url'),authenticatorData:auth.toString('base64url'),signature:signature.toString('base64url')}} as AuthenticationResponseJSON;
 }
 async function call(route:string,ceremony?:string,body:unknown={}) {return (await runOutlayerRecovery(context(route,ceremony,body as Record<string,unknown>),verifyAssertion,register))!;}
 async function prepareTest() {
  const prepared=await call('prepare'),a=prepared.cookies[0].value;
  const authorized=await call('authorize',a,assertion(primary,a)),b=authorized.cookies[0].value;
  const registered=await call('register',b,{fixture:'mocked registration response'});
  return registered.cookies[0].value;
 }
 return {primary,backup,store,context,call,assertion,prepareTest,register};
}
test('requires current-owner approval and a real recovery assertion before saving; never changes login authority',async()=>{
 const f=fixture(),ceremony=await f.prepareTest();
 expect(await f.store.read(s=>s.accounts.a.outlayerRecovery)).toBeUndefined();
 const result=await f.call('test',ceremony,f.assertion(f.backup,ceremony));
 expect(result.body).toMatchObject({recovery:{status:'prepared',installedOnChain:false}});
 const a=await f.store.read(s=>s.accounts.a);
 expect(a.outlayerRecovery).toMatchObject({id:f.backup.id,sourceCredentialId:f.primary.id,authority:'full-owner',counter:1});
 expect(a.credentialId).toBe(f.primary.id);
 expect(a.backup).toBeUndefined();
 await expect(f.call('test',ceremony,{})).rejects.toThrow();
});
test('rejects another credential during the possession test',async()=>{
 const f=fixture(),c=await f.prepareTest();
 await expect(f.call('test',c,f.assertion(f.primary,c))).rejects.toThrow();
 expect(await f.store.read(s=>s.accounts.a.outlayerRecovery)).toBeUndefined();
});
test('changed primary authority invalidates enrollment',async()=>{
 const f=fixture(),c=await f.prepareTest();
 await f.store.transaction(s=>{s.accounts.a.credentialId='changed';});
 await expect(f.call('test',c,f.assertion(f.backup,c))).rejects.toThrow();
});
test('revoked login session invalidates enrollment',async()=>{
 const f=fixture(),c=await f.prepareTest();
 await f.store.transaction(s=>{delete s.sessions[hash('session')];});
 await expect(f.call('test',c,f.assertion(f.backup,c))).rejects.toThrow();
});
test('expired ceremony cannot save a recovery credential',async()=>{
 const f=fixture(),c=await f.prepareTest();
 await f.store.transaction(s=>{s.challenges[hash(c)].expires=1;});
 await expect(f.call('test',c,f.assertion(f.backup,c))).rejects.toThrow();
});
test('an enrolled credential cannot silently be replaced',async()=>{
 const f=fixture(),c=await f.prepareTest();
 await f.call('test',c,f.assertion(f.backup,c));
 await expect(f.call('prepare')).rejects.toThrow();
});
test('recovery transitions refuse out-of-order events and the primary credential',()=>{
 const source={phase:'authorize' as const,sourceCredentialId:'primary',sourcePublicKey:'main',sessionHash:'s'};
 expect(nextRecoveryEnrollment(source,{type:'tested',counter:1})).toBeUndefined();
 const register=nextRecoveryEnrollment(source,{type:'authorized'})!;
 expect(nextRecoveryEnrollment(register,{type:'registered',candidate:{id:'primary',publicKey:'different',counter:0}})).toBeUndefined();
});
test('missing immutable publication is distinct from an RPC error',async()=>{
 const remote=vi.fn<typeof fetch>(async()=>Response.json({error:{cause:{name:'NO_GLOBAL_CONTRACT_CODE',info:{block_hash:'block',block_height:1}}}}));
 expect((await readImmutableOwnerCode(remote)).status).toBe('publication-required');
 expect(JSON.parse(String(remote.mock.calls[0][1]?.body)).params.request_type).toBe('view_global_contract_code');
 const unavailable=vi.fn<typeof fetch>(async()=>Response.json({error:{cause:{name:'UNKNOWN_BLOCK'}}}));
 await expect(readImmutableOwnerCode(unavailable)).rejects.toThrow('not confirmed');
});
test('recovery browser state excludes quotes and refuses stale or out-of-order completion',()=>{
 const initial:SetupState={phase:'review',setup:{network:'mainnet',name:'Main',originalUnchanged:true,owner:'unchecked',controllerId:'x',blockers:[],canProvision:false,recovery:{status:'needed',authority:'full-owner',installedOnChain:false}}};
 const working=nextSetup(initial,{type:'recovery-start',id:'r'})!;
 expect(setupPresentation(working).busy).toBe(true);
 expect(nextSetup(working,{type:'quote',id:'q'})).toBeUndefined();
 expect(nextSetup(working,{type:'recovery-advance',id:'other',phase:'registering'})).toBeUndefined();
 expect(nextSetup(working,{type:'recovery-advance',id:'r',phase:'testing'})).toBeUndefined();
});
test('prepared recovery survives local D1 persistence and challenge validation',async()=>{
 const {harness,origin}=await import('./d1-harness');
 const {D1Store}=await import('../src/near/repositories/d1-store');
 const {StatementBudget}=await import('../src/near/repositories/request-budget');
 vi.stubEnv('FINANCIAL_HISTORY_ACTIVE_KEY_ID','test');
 vi.stubEnv('FINANCIAL_HISTORY_KEYS',JSON.stringify({test:'b'.repeat(64)}));
 const h=await harness();
 try {
  const f=fixture(),c=await f.prepareTest();
  const assertion=f.assertion(f.backup,c);
  const seed=await f.store.read(s=>s);
  const store=new D1Store(h.db,origin,new StatementBudget('paid'));
  await store.transaction(s=>{s.accounts=seed.accounts;s.sessions=seed.sessions;s.challenges=seed.challenges;});
  await runOutlayerRecovery({...f.context('test',c,assertion as unknown as Record<string,unknown>),store},verifyAssertion,f.register);
  const reloaded=new D1Store(h.db,origin,new StatementBudget('paid'));
  expect((await reloaded.read(s=>s.accounts.a)).outlayerRecovery).toMatchObject({phase:'prepared',id:f.backup.id,authority:'full-owner',counter:1});
 } finally {await h.mf.dispose();}
});
