// @vitest-environment node
import { describe, expect, it } from "vitest";
import { emptyState, type StateStore } from "../../../backend/id/src/near/repositories/store";
import { discoverTokens, discoverTokensThen, requireToken, requireTradingPair } from "../../../backend/id/src/near/services/token-policy";
import { DEFAULT_PAIR } from "../../../packages/wallet-contracts/src/domain/catalog";
import { approvedTestTokens } from "./fixtures/token-policy";
import { applyTokenMetadata, effectiveCoinGeckoId, selectableTradingAssets, tokenAllowed, type TokenRecord } from "../../../packages/wallet-contracts/src/domain/token-registry";
const base = { ...DEFAULT_PAIR.base, coingeckoId: "near" }, quote = { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" };
const now = Date.now();
function fixture() {
 let state = emptyState(); state.tokens = Object.fromEntries(approvedTestTokens([base,quote]).map(t => [t.id,t]));
 const store: StateStore = { read: async fn => fn(structuredClone(state)), transaction: async fn => { const draft=structuredClone(state); const result=fn(draft); state=draft; return result; } }; return store;
}
/** A reviewed token record, written as stored data. */
const review = (store: StateStore, next: TokenRecord) => store.transaction(s => { s.tokens![next.id] = { ...next, revision: next.revision + 1 }; });
describe('explicit token approvals', () => {
 it('fails closed for absent approval and exact identity changes', async () => {
  const store=fixture(); const row=await store.read(s=>s.tokens![base.assetId]);
  expect(selectableTradingAssets([base],[])).toEqual([]);
  expect(selectableTradingAssets([base,base],[row])).toEqual([]);
  await expect(discoverTokens(store,[base,base])).rejects.toThrow();
  expect(tokenAllowed(base,row,'trading')).toBe(true);
  for(const change of [{symbol:'OTHER'},{blockchain:'eth'},{decimals:6},{coingeckoId:'other'},{contractAddress:'other'},{assetId:'other'}]) expect(tokenAllowed({...base,...change},row,'trading')).toBe(false);
  await store.read(s=>requireTradingPair(s,{...DEFAULT_PAIR,base,quote}));
 });
 it('discovers pending and allows only reviewed capabilities',async()=>{
  const store=fixture(), asset={...base,assetId:'new:asset'};await discoverTokens(store,[asset],now);
  const row=await store.read(s=>s.tokens![asset.assetId]);expect(row).toMatchObject({status:'pending',trading:false,deposits:false,withdrawals:false});
  await review(store,{...row,status:'approved',deposits:true});await store.read(s=>requireToken(s,asset,'deposits'));
  await expect(store.read(s=>requireToken(s,asset,'withdrawals'))).rejects.toThrow();
 });
 it('revokes capabilities on metadata drift and preserves wallet data',async()=>{
  const store=fixture();await store.transaction(s=>{s.accounts.keep={id:'keep',kind:'passkey',counter:7};});
  await discoverTokens(store,[{...base,decimals:6}],now);
  expect(await store.read(s=>s.tokens![base.assetId])).toMatchObject({status:'pending',trading:false,deposits:false,withdrawals:false});
  await expect(store.read(s=>requireToken(s,base,'trading'))).rejects.toThrow();
  expect(await store.read(s=>s.accounts.keep.counter)).toBe(7);
 });
 it('checks a pair against the discovered registry, not the snapshot from before an identity change',async()=>{
  const store=fixture(), pair={...DEFAULT_PAIR,base,quote};
  expect(await discoverTokensThen(store,[base,quote],s=>{requireTradingPair(s,pair);return 'checked';},now)).toBe('checked');
  // The provider changed the base token's identity: the pre-discovery row still approves the
  // reviewed pair, but discovery demotes it before the check runs.
  await expect(discoverTokensThen(store,[{...base,decimals:6},quote],s=>requireTradingPair(s,pair),now)).rejects.toThrow();
  expect(await store.read(s=>s.tokens![base.assetId].status)).toBe('pending');
 });
 it('lets a changed identity stand while readers still hold the provider\'s previous list',async()=>{
  const store=fixture(), renamed={...base,symbol:`${base.symbol}(DEPRECATED)`}, pair={...DEFAULT_PAIR,base,quote};
  const observedAt=()=>store.read(s=>s.tokens![base.assetId].observedAt);
  await discoverTokens(store,[renamed,quote],now);
  // A reader with the previous list neither rewrites the token nor may trade it.
  await expect(discoverTokensThen(store,[base,quote],s=>requireTradingPair(s,pair),now+60_000)).rejects.toThrow();
  expect(await store.read(s=>s.tokens![base.assetId])).toMatchObject({observed:{symbol:renamed.symbol},status:'pending'});
  expect(await observedAt()).toBe(now);
  // A review in the meantime does not reopen the token to that reader.
  const row=await store.read(s=>s.tokens![base.assetId]);
  await review(store,{...row,identity:row.observed,status:'approved',trading:true});
  await discoverTokens(store,[base,quote],now+120_000);
  expect(await store.read(s=>s.tokens![base.assetId])).toMatchObject({observed:{symbol:renamed.symbol},status:'approved'});
  // Once the identity has stood for half an hour, a different one is a new change.
  await discoverTokens(store,[base,quote],now+30*60_000);
  expect(await store.read(s=>s.tokens![base.assetId])).toMatchObject({observed:{symbol:base.symbol},status:'pending'});
  expect(await observedAt()).toBe(now+30*60_000);
 });
 it('disabling after preparation blocks the submission guard without deleting records',async()=>{
  const store=fixture();const reviewed=await store.read(s=>s.tokens![base.assetId]);
  await review(store,{...reviewed,status:'disabled',trading:false,deposits:false,withdrawals:false});
  await expect(store.transaction(s=>{requireTradingPair(s,{...DEFAULT_PAIR,base,quote});s.accounts.sent={id:'sent',kind:'passkey',counter:1};})).rejects.toThrow();
  expect(await store.read(s=>s.accounts.sent)).toBeUndefined();
 });
});

it('persists a manual CoinGecko mapping independently from provider identity and clears back to the provider',async()=>{
 const store=fixture(), row=await store.read(s=>s.tokens![base.assetId]);
 await review(store,{...row,coingeckoIdOverride:'reviewed-coin'});
 const saved=await store.read(s=>s.tokens![base.assetId]);
 expect(saved.identity.coingeckoId).toBe('near');expect(effectiveCoinGeckoId(saved)).toBe('reviewed-coin');
 expect(tokenAllowed(base,saved,'trading')).toBe(true);
 expect(applyTokenMetadata([base],[saved])[0]).toMatchObject({coingeckoId:'near',coingeckoIdOverride:'reviewed-coin'});
 await discoverTokens(store,[{...base,coingeckoId:'provider-changed'}],now+1);
 const changed=await store.read(s=>s.tokens![base.assetId]);
 expect(changed).toMatchObject({coingeckoIdOverride:'reviewed-coin',status:'pending',trading:false});
 expect(applyTokenMetadata([{...base,coingeckoId:'provider-changed'}],[changed])[0].coingeckoIdOverride).toBeUndefined();
 await review(store,{...changed,identity:changed.observed,status:'approved',trading:true,coingeckoIdOverride:''});
 expect(await store.read(s=>effectiveCoinGeckoId(s.tokens![base.assetId]))).toBe('provider-changed');
});
it('allows reviewed overrides for missing provider IDs and retains technical identity checks',async()=>{
 const store=fixture(), asset={...base,assetId:'override-only',coingeckoId:''};
 await discoverTokens(store,[asset],now);const row=await store.read(s=>s.tokens![asset.assetId]);
 await review(store,{...row,status:'approved',trading:true,coingeckoIdOverride:'verified-coin'});
 const saved=await store.read(s=>s.tokens![asset.assetId]);
 expect(selectableTradingAssets([asset],[saved])).toHaveLength(1);
 expect(tokenAllowed({...asset,decimals:6},saved,'trading')).toBe(false);
});
