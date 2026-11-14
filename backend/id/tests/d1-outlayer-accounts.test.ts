import {expect,test} from 'vitest';
import {activationFixture} from './outlayer-activation-fixture';
import {accountFor} from '../src/near/repositories/store';
import {createTradingAccount,tradingAccountStore,selectedTradingAccount,tradingAccountsView,discardTradingSetup,resumeTradingAccount,saveTradingPaymentAsset,setupMetadata,legacyTradingSetupStore} from '../src/near/outlayer/accounts';
import {currentActivation} from '../src/near/outlayer/activation-runner';
import {activationOperationSchema} from '../src/near/outlayer/activation-state';
import {encodeFinancialRecord,decodeFinancialRecord} from '../src/near/repositories/financial-history';
const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function seedRecord(f:ReturnType<typeof activationFixture>,id:string,name:string){await f.store.transaction(s=>{s.accounts.a.outlayerTradingAccounts??={};s.accounts.a.outlayerTradingAccounts[id]={id,name,createdAt:Date.now(),lifecycle:{phase:'open'}};});}
test('one pending creation is reused across repeated and different request IDs',async()=>{
 const f=activationFixture();await f.store.transaction(s=>{delete s.accounts.a.outlayerSetupDraft;delete s.accounts.a.outlayerActivation;});
 expect(await createTradingAccount(f.store,'session',{requestId:a,name:'Strategy A'})).toMatchObject({id:a,name:'Strategy A'});
 expect(await createTradingAccount(f.store,'session',{requestId:b,name:'Strategy B'})).toMatchObject({id:a,name:'Strategy A'});
 expect(Object.keys((await f.store.read(s=>s.accounts.a)).outlayerTradingAccounts!)).toEqual([a]);
});
test('wallet-scoped writes preserve the legacy wallet, other wallets and the shared passkey counter',async()=>{
 const f=activationFixture();
 for(const [id,name] of [[a,'A'],[b,'B']])await seedRecord(f,id,name);
 const scoped=tradingAccountStore(f.store,'a',a);
 expect(await scoped.read(s=>s.accounts.a.outlayerActivation)).toBeUndefined();
 await scoped.transaction(s=>{const account=accountFor(s,'session')!;account.counter=2;account.outlayerActivation={...f.op,id:a};});
 const account=await f.store.read(s=>s.accounts.a);
 expect(account.counter).toBe(2);expect(account.outlayerActivation).toEqual(f.op);
 expect(account.outlayerTradingAccounts![a].activation?.id).toBe(a);
 expect(account.outlayerTradingAccounts![b].activation).toBeUndefined();
 expect((await scoped.read(s=>s.accounts.a)).outlayerActivation?.id).toBe(a);
});
test('a request cannot reconcile another wallet operation or select an unowned/prototype record',async()=>{
 const f=activationFixture();await seedRecord(f,a,'A');
 const scoped=tradingAccountStore(f.store,'a',a);
 await expect(currentActivation(scoped,'session',f.op.id)).rejects.toThrow();
 const account=await f.store.read(s=>s.accounts.a);
 for(const id of [b,'__proto__','constructor'])expect(()=>selectedTradingAccount(account,id)).toThrow();
 expect(()=>tradingAccountStore(f.store,'a','__proto__').read(s=>s.accounts.a)).toThrow();
});
test('a failed scoped callback cannot replace the legacy journal',async()=>{
 const f=activationFixture();await seedRecord(f,a,'A');
 expect(()=>tradingAccountStore(f.store,'a',a).transaction(s=>{s.accounts.a.outlayerActivation={...f.op,id:a};throw new Error('stop');})).toThrow('stop');
 expect(await f.store.read(s=>s.accounts.a.outlayerActivation)).toEqual(f.op);
});
test('verified account metadata is independent of unfinished refunds and excludes failed/unbound drafts',async()=>{
 const f=activationFixture();await seedRecord(f,a,'A');
 const scoped=tradingAccountStore(f.store,'a',a);
 // Copy the real fixture draft from the unprojected snapshot, then mark only this wallet active.
 const draft=await f.store.read(s=>s.accounts.a.outlayerSetupDraft);
 await scoped.transaction(s=>{s.accounts.a.outlayerSetupDraft=structuredClone(draft);s.accounts.a.outlayerActivation=activationOperationSchema.parse({...f.op,phase:'refund',outcome:'active',retainedControllerYoctoNear:'1',refund:{phase:'owed',amount:'1',reason:'Claimable'}});});
 const account=await f.store.read(s=>s.accounts.a);
 expect(tradingAccountsView(account).wallets.map(w=>[w.id,w.name])).toEqual([[a,'A']]);
 expect(tradingAccountsView({...account,credentialId:'other'}).wallets).toEqual([]);
});
test('all per-wallet journals and private names are covered by account encryption',async()=>{
 const f=activationFixture(),account=await f.store.read(s=>s.accounts.a);
 account.outlayerTradingAccounts={[a]:{id:a,name:'Private strategy',createdAt:1,activation:f.op,draft:account.outlayerSetupDraft}};
 const encoded=encodeFinancialRecord('accounts','a',account,'http://localhost:3101');
 for(const value of ['Private strategy',f.op.payerSeed,f.op.plan.paymentPayload])expect(JSON.stringify(encoded)).not.toContain(value);
 expect(decodeFinancialRecord('accounts','a',encoded,'http://localhost:3101')).toEqual(account);
});

test('multiple-account state survives encrypted D1 reload without replacing legacy activation',async()=>{
 const {harness,origin}=await import('./d1-harness'),{D1Store}=await import('../src/near/repositories/d1-store'),{StatementBudget}=await import('../src/near/repositories/request-budget');
 const h=await harness();try{
  const f=activationFixture();await seedRecord(f,a,'Private strategy');
  await tradingAccountStore(f.store,'a',a).transaction(s=>{s.accounts.a.outlayerActivation={...f.op,id:a};});
  const seed=await f.store.read(s=>s),store=new D1Store(h.db,origin,new StatementBudget('paid'));
  await store.transaction(s=>{s.accounts=seed.accounts;s.sessions=seed.sessions;});
  const raw=await h.raw.prepare('SELECT data FROM id_accounts WHERE id=?').bind('a').first<{data:string}>();
  expect(raw?.data).not.toContain('Private strategy');expect(raw?.data).not.toContain(f.op.payerSeed);
  const restored=await new D1Store(h.db,origin,new StatementBudget('paid')).read(s=>s.accounts.a);
  expect(restored.outlayerActivation).toEqual(f.op);
  expect(selectedTradingAccount(restored,a).outlayerActivation?.id).toBe(a);
 }finally{await h.mf.dispose();}
});

test('resume chooses the most advanced unpaid draft and archives duplicates without deleting them',async()=>{
 const f=activationFixture();await f.store.transaction(s=>{delete s.accounts.a.outlayerActivation;delete s.accounts.a.outlayerSetupDraft;});
 await seedRecord(f,a,'A');await seedRecord(f,b,'B');
 const fixture=activationFixture(),draft=await fixture.store.read(s=>s.accounts.a.outlayerSetupDraft!);
 await f.store.transaction(s=>{s.accounts.a.outlayerTradingAccounts![b].draft=draft;});
 expect(await resumeTradingAccount(f.store,'session')).toEqual({id:b,name:'B'});
 const account=await f.store.read(s=>s.accounts.a);
 expect(account.outlayerTradingAccounts![a].lifecycle?.phase).toBe('discarded');
 expect(account.outlayerTradingAccounts![b].draft).toEqual(draft);
 expect(tradingAccountsView(account).setups).toEqual([{id:b,name:'B'}]);
});
test('discard preserves an unpaid draft and quote history but fences every later scoped write',async()=>{
 const f=activationFixture();await seedRecord(f,a,'A');
 await f.store.transaction(s=>{s.accounts.a.outlayerTradingAccounts![a].activation=f.op;});
 const scoped=tradingAccountStore(f.store,'a',a);
 await discardTradingSetup(f.store,'session',a);await discardTradingSetup(f.store,'session',a);
 const record=await f.store.read(s=>s.accounts.a.outlayerTradingAccounts![a]);
 expect(record.activation).toEqual(f.op);expect(record.lifecycle?.phase).toBe('discarded');
 expect(()=>scoped.transaction(s=>{s.accounts.a.outlayerActivation=undefined;})).toThrow();
 const account=await f.store.read(s=>s.accounts.a);expect(()=>selectedTradingAccount(account,a)).toThrow();
});
test('paid or uncertain setup cannot be discarded, replaced or have its payment token changed',async()=>{
 const f=activationFixture();await seedRecord(f,a,'A');
 const pending=activationOperationSchema.parse({...f.op,phase:'payment-pending'});
 await f.store.transaction(s=>{s.accounts.a.outlayerTradingAccounts![a].activation=pending;});
 await expect(Promise.resolve().then(()=>discardTradingSetup(f.store,'session',a))).rejects.toThrow();
 await expect(Promise.resolve().then(()=>saveTradingPaymentAsset(f.store,'session',a,'NEAR'))).rejects.toThrow();
 expect(await createTradingAccount(f.store,'session',{requestId:b,name:'B'})).toMatchObject({id:a,name:'A'});
 expect(await f.store.read(s=>s.accounts.a.outlayerTradingAccounts![a].activation)).toEqual(pending);
});
test('selected token persists before payment and legacy discard also fences old in-flight callers',async()=>{
 const f=activationFixture();await seedRecord(f,a,'A');
 await saveTradingPaymentAsset(f.store,'session',a,'NEAR');
 const account=await f.store.read(s=>s.accounts.a);expect(setupMetadata(selectedTradingAccount(account,a),a).paymentAsset).toBe('NEAR');
 const legacy=legacyTradingSetupStore(f.store,'a');
 await discardTradingSetup(f.store,'session',f.op.plan.walletId);
 expect(()=>legacy.transaction(s=>{s.accounts.a.outlayerActivation=undefined;})).toThrow();
});
