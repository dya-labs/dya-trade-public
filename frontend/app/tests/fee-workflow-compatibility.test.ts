// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {runMarketTrades} from '../../../backend/id/src/near/services/market-trades-workflow';
import {emptyState,hash,type StateStore} from '../../../backend/id/src/near/repositories/store';
import type {AccountWorkflowContext} from '../../../backend/id/src/near/services/workflow-context';
import type {ExecutableMarketTrade} from '../../../backend/id/src/near/services/market-execution';
import {verifyFeeAllocations} from '../../../backend/id/src/near/services/fee-verification';
import {DEFAULT_TRADING_FEE_POLICY,type FeePlan} from '../../../packages/wallet-contracts/src/domain/trading-fees';
import {DEFAULT_PAIR} from '../../../packages/wallet-contracts/src/domain/catalog';
import {approvedTestTokens} from './fixtures/token-policy';
const hooks=vi.hoisted(()=>({prepare:vi.fn(),options:vi.fn()}));
vi.mock('../../../backend/id/src/near/services/market-execution',async original=>({...await original<typeof import('../../../backend/id/src/near/services/market-execution')>(),prepareExecutableMarketTrade:hooks.prepare}));
vi.mock('@simplewebauthn/server',async original=>({...await original<typeof import('@simplewebauthn/server')>(),generateAuthenticationOptions:hooks.options}));
vi.mock('../../../backend/id/src/near/auth/intents',async original=>({...await original<typeof import('../../../backend/id/src/near/auth/intents')>(),accountIdentity:()=>({accountId:'0x'+'a'.repeat(40)})}));
vi.mock('../../../backend/id/src/near/providers/catalog',async original=>({...await original<typeof import('../../../backend/id/src/near/providers/catalog')>(),readCatalog:async()=>[{...DEFAULT_PAIR.base,coingeckoId:'near'},{...DEFAULT_PAIR.quote,coingeckoId:'usd-coin'}]}));
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('DYA_TRADING_FEES_ACTIVATION_ALLOWED','false');vi.stubEnv('DYA_LIMIT_FEES_VERIFIED','false');vi.stubEnv('DYA_MAX_PROVIDER_FEE_BPS','20');hooks.options.mockResolvedValue({challenge:'synthetic-challenge'});});
afterEach(()=>vi.unstubAllEnvs());
function setup(enabled=false){
 const state=emptyState(),session='synthetic-session';
 const account={id:'user',kind:'passkey' as const,publicKey:'synthetic',credentialId:'credential',counter:1};
 state.accounts.user=account;state.sessions[hash(session)]={accountId:'user',expires:Date.now()+60000};
 const catalog=[{...DEFAULT_PAIR.base,coingeckoId:'near'},{...DEFAULT_PAIR.quote,coingeckoId:'usd-coin'}];
 state.tokens=Object.fromEntries(approvedTestTokens(catalog).map(t=>[t.id,t]));
 if(enabled)state.accessRecords={'trading-fees':{id:'trading-fees',kind:'fee-setting',policy:{...DEFAULT_TRADING_FEE_POLICY,enabled:true,revision:1},updatedAt:Date.now(),updatedBy:'operator'}};
 const store:StateStore={read:fn=>fn(state),transaction:fn=>fn(state)};
 const review={payload:'synthetic-reviewed-payload',challenge:'c3ludGhldGlj',expiresAt:new Date(Date.now()+60000).toISOString()} as ExecutableMarketTrade;
 const context={route:'live/market/prepare',body:{side:'buy',quantity:'1'},account,session,store,deployment:{rpId:'localhost',origin:'http://localhost:3101'},url:new URL('http://localhost:3101'),balanceReader:vi.fn(async()=>({accountId:'0x'+'a'.repeat(40),assets:catalog.map(a=>({...a,raw:'100000000',amount:'100'})),checkedAt:Date.now(),blockHeight:1}))} as unknown as AccountWorkflowContext;
 return {state,context,review};
}
it('fees off preserves market preparation and passes no DYA plan to the provider adapter (mock boundary)',async()=>{
 const {state,context,review}=setup();hooks.prepare.mockResolvedValue(review);
 const result=await runMarketTrades(context);
 expect(result?.status).toBe(200);
 expect(hooks.prepare.mock.calls[0][8]).toBeUndefined();
 expect(hooks.options).toHaveBeenCalledOnce();
 expect(Object.values(state.challenges)).toHaveLength(1);
 expect(Object.values(state.accessRecords??{}).filter(r=>r.kind==='fee-setting')).toHaveLength(0);
});
it('fees on passes the immutable verified plan and does not use the legacy adapter mode',async()=>{
 const {context,review}=setup(true);vi.stubEnv('DYA_TRADING_FEES_ACTIVATION_ALLOWED','true');vi.stubEnv('DYA_LIMIT_FEES_VERIFIED','true');
 hooks.prepare.mockImplementation(async(...args:unknown[])=>{const plan=args[8] as FeePlan;return {...review,feeReceipt:verifyFeeAllocations([{recipient:plan.recipient,fee:5},{recipient:'provider.near',fee:20}],plan)};});
 await runMarketTrades(context);
 expect(hooks.prepare.mock.calls[0][8]).toMatchObject({requestedDyaBps:5,maxTotalBps:25,revision:1});
});
it('activation during a provider-only preparation invalidates the old result before a ceremony is issued',async()=>{
 const {state,context,review}=setup();hooks.prepare.mockImplementation(async()=>{state.accessRecords={'trading-fees':{id:'trading-fees',kind:'fee-setting',policy:{...DEFAULT_TRADING_FEE_POLICY,enabled:true,revision:1},updatedAt:Date.now(),updatedBy:'operator'}};return review;});
 await expect(runMarketTrades(context)).rejects.toThrow('5 bps');
 expect(hooks.options).not.toHaveBeenCalled();expect(Object.values(state.challenges)).toHaveLength(0);
});
