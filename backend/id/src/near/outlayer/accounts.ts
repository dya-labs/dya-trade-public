import { DYA_WALLET_NAMES } from "@dya/config";
import { z } from 'zod';
import { AppError,ErrorCode } from '../../../../../packages/wallet-contracts/src/domain/errors';
import { accountFor,type Account,type State,type StateStore } from '../repositories/store';

import type { TradingWithdrawalState } from "./trading-withdrawal-state";
import type { SendPolicyState } from "./send-policy-state";

export type SetupLifecycle={phase:'open'}|{phase:'discarded';at:number};
export type SetupPreferences={lifecycle?:SetupLifecycle;paymentAsset?:'USDC'|'NEAR';sendPolicy?:SendPolicyState;withdrawals?:Record<string,TradingWithdrawalState>};
export type TradingAccountRecord=SetupPreferences&{id:string;name:string;createdAt:number;draft?:Account['outlayerSetupDraft'];activation?:Account['outlayerActivation'];history?:Account['outlayerActivationHistory']};
const fields=['outlayerSetupDraft','outlayerActivation','outlayerActivationHistory'] as const;
/** Project one owned wallet into the existing execution journal. All writes still
 * use the parent's atomic account transaction; source credential/counter stay shared.
 * Restore legacy fields before persistence, including on a callback failure. */
export function tradingAccountStore(store:StateStore,ownerId:string,id:string):StateStore {
 function project<T>(s:State,fn:(s:State)=>T,write:boolean):T {
  const a=s.accounts[ownerId],map=a?.outlayerTradingAccounts,record=map&&Object.hasOwn(map,id)?map[id]:undefined;
  if(!a||!record||record.lifecycle?.phase==='discarded')throw new AppError(ErrorCode.WalletChanged);
  const saved=fields.map(f=>a[f]);
  a.outlayerSetupDraft=record.draft;a.outlayerActivation=record.activation;a.outlayerActivationHistory=record.history;
  try {
   const result=fn(s);
   if(write){record.draft=a.outlayerSetupDraft;record.activation=a.outlayerActivation;record.history=a.outlayerActivationHistory;}
   return structuredClone(result);
  } finally {fields.forEach((f,i)=>{if(saved[i]===undefined)delete a[f];else Object.assign(a,{[f]:saved[i]});});}
 }
 return {read:fn=>store.read(s=>project(s,fn,false)),transaction:fn=>store.transaction(s=>project(s,fn,true)),
  ...(store.saveChallenge?{saveChallenge:store.saveChallenge.bind(store)}:{}),...(store.bindCeremony?{bindCeremony:store.bindCeremony.bind(store)}:{})};
}
export function tradingAccountsView(a:Account) {
 const entries:TradingAccountRecord[]=[...(a.outlayerSetupDraft? [{id:'walletId' in a.outlayerSetupDraft?a.outlayerSetupDraft.walletId:a.outlayerSetupDraft.id,name:DYA_WALLET_NAMES.legacyTrading,...a.outlayerLegacySetup,createdAt:a.outlayerSetupDraft.createdAt,draft:a.outlayerSetupDraft,activation:a.outlayerActivation}]:[]),...Object.values(a.outlayerTradingAccounts??{})];
 const wallets: {id:string;name:string;controllerId:string;recoveryInstalled:boolean}[]=[];
 for(const entry of entries){
  if(entry.lifecycle?.phase==='discarded')continue;
  const op=entry.activation;
  if(op&&(op.phase==='refund'||op.phase==='complete')&&op.outcome==='active'&&op.plan.credentialId===a.credentialId&&op.plan.publicKey===a.publicKey&&op.plan.draftId===entry.draft?.id)wallets.push({id:entry.id,name:entry.name,controllerId:op.plan.controllerId,recoveryInstalled:!!op.plan.recoveryControllerId});
 }
 const pending=pendingTradingSetups(a);
 return {wallets,setups:pending.map(r=>({id:r.id,name:r.name}))};
}
export function isLegacyTradingAccount(a:Account,id:string) {return !!a.outlayerSetupDraft&&(a.outlayerSetupDraft.id===id||'walletId' in a.outlayerSetupDraft&&a.outlayerSetupDraft.walletId===id);}
export function selectedTradingAccount(a:Account,id:string|null) {
 if(!id||isLegacyTradingAccount(a,id)){if(a.outlayerLegacySetup?.lifecycle?.phase==='discarded')throw new AppError(ErrorCode.WalletChanged);return a;}
 const map=a.outlayerTradingAccounts;const record=map&&Object.hasOwn(map,id)?map[id]:undefined;if(!record||record.lifecycle?.phase==='discarded')throw new AppError(ErrorCode.WalletChanged);
 return {...a,outlayerSetupDraft:record.draft,outlayerActivation:record.activation,outlayerActivationHistory:record.history};
}
export async function createTradingAccount(store:StateStore,session:string,body:unknown) {
 const input=z.object({requestId:z.string().uuid(),paymentAsset:z.enum(['USDC','NEAR']).default('USDC'),name:z.string().trim().min(1).max(32).regex(/^[^\u0000-\u001f\u007f]+$/)}).strict().parse(body);
 return store.transaction(s=>{
  const a=accountFor(s,session);if(!a)throw new AppError(ErrorCode.SessionExpired);
  if(isLegacyTradingAccount(a,input.requestId))throw new AppError(ErrorCode.InvalidRequest);
  a.outlayerTradingAccounts??={};
  const existing=a.outlayerTradingAccounts[input.requestId];
  if(existing){if(existing.lifecycle?.phase==='discarded')throw new AppError(ErrorCode.InvalidRequest);return {id:existing.id,name:existing.name,resumed:true};}
  const pending=resumePending(a);
  if(pending)return {id:pending.id,name:pending.name,resumed:true};
  // Bound encrypted record growth without the former one-wallet product limit.
  if(Object.keys(a.outlayerTradingAccounts).length>=50)throw new AppError(ErrorCode.InvalidRequest);
  const id=input.requestId;
  a.outlayerTradingAccounts[id]={id,name:input.name,paymentAsset:input.paymentAsset,createdAt:Date.now(),lifecycle:{phase:'open'}};
  return {id,name:input.name};
 });
}

export function canDiscardSetup(record:Pick<TradingAccountRecord,'draft'|'activation'|'history'|'lifecycle'>) {
 const unpaid=(op:NonNullable<TradingAccountRecord['activation']>)=>op.phase==='review'&&!op.paymentIntentHash&&op.transactions.length===0;
 return record.lifecycle?.phase!=='discarded'&&record.draft?.phase!=='registering'&&(!record.activation||unpaid(record.activation))&&Object.values(record.history??{}).every(unpaid);
}
function isPendingSetup(record:TradingAccountRecord) {
 if(record.lifecycle?.phase==='discarded')return false;
 const op=record.activation;
 if(!op)return true;
 if(op.phase==='complete')return false;
 if(op.phase==='refund'&&op.outcome==='active')return false;
 if(op.phase==='refund'&&op.refund.phase==='owed'&&op.refund.amount==='0')return false;
 return true;
}
export function pendingTradingSetups(a:Account):TradingAccountRecord[] {
 const legacy=a.outlayerSetupDraft?[{id:'walletId'in a.outlayerSetupDraft?a.outlayerSetupDraft.walletId:a.outlayerSetupDraft.id,name:DYA_WALLET_NAMES.legacyTrading,createdAt:a.outlayerSetupDraft.createdAt,...a.outlayerLegacySetup,draft:a.outlayerSetupDraft,activation:a.outlayerActivation,history:a.outlayerActivationHistory}]:[];
 const rank=(r:TradingAccountRecord)=>r.activation&&r.activation.phase!=='review'?4:r.activation?3:r.draft?2:1;
 return [...legacy,...Object.values(a.outlayerTradingAccounts??{})].filter(isPendingSetup).sort((a,b)=>rank(b)-rank(a)||b.createdAt-a.createdAt||a.id.localeCompare(b.id));
}
export function setupMetadata(a:Account,id?:string|null) {
 const record=id&&Object.hasOwn(a.outlayerTradingAccounts??{},id)?a.outlayerTradingAccounts![id]:a.outlayerSetupDraft?{...a.outlayerLegacySetup,draft:a.outlayerSetupDraft,activation:a.outlayerActivation,history:a.outlayerActivationHistory}:undefined;
 return {canDiscard:!!record&&canDiscardSetup(record),paymentAsset:record?.paymentAsset??record?.activation?.plan.asset??'USDC' as 'USDC'|'NEAR'};
}
export async function discardTradingSetup(store:StateStore,session:string,id:string) {
 return store.transaction(s=>{
  const a=accountFor(s,session);if(!a)throw new AppError(ErrorCode.SessionExpired);
  if(isLegacyTradingAccount(a,id)){
   if(a.outlayerLegacySetup?.lifecycle?.phase==='discarded')return;
   if(!canDiscardSetup({draft:a.outlayerSetupDraft,activation:a.outlayerActivation,history:a.outlayerActivationHistory,...a.outlayerLegacySetup}))throw new AppError(ErrorCode.InvalidRequest);
   a.outlayerLegacySetup={...a.outlayerLegacySetup,lifecycle:{phase:'discarded',at:Date.now()}};
  }else{
   const r=a.outlayerTradingAccounts&&Object.hasOwn(a.outlayerTradingAccounts,id)?a.outlayerTradingAccounts[id]:undefined;
   if(r?.lifecycle?.phase==='discarded')return;
   if(!r||!canDiscardSetup(r))throw new AppError(ErrorCode.InvalidRequest);
   r.lifecycle={phase:'discarded',at:Date.now()};
  }
  // Keep credentials, quotes and history encrypted for audit. No provider deletion.
 });
}
export async function saveTradingPaymentAsset(store:StateStore,session:string,id:string,asset:'USDC'|'NEAR') {
 await store.transaction(s=>{
  const a=accountFor(s,session);if(!a)throw new AppError(ErrorCode.SessionExpired);
  if(isLegacyTradingAccount(a,id)){
   if(!canDiscardSetup({draft:a.outlayerSetupDraft,activation:a.outlayerActivation,history:a.outlayerActivationHistory,...a.outlayerLegacySetup}))throw new AppError(ErrorCode.InvalidRequest);
   a.outlayerLegacySetup={...a.outlayerLegacySetup,paymentAsset:asset};
  }else{
   const r=a.outlayerTradingAccounts&&Object.hasOwn(a.outlayerTradingAccounts,id)?a.outlayerTradingAccounts[id]:undefined;
   if(!r||!canDiscardSetup(r))throw new AppError(ErrorCode.InvalidRequest);
   r.paymentAsset=asset;
  }
 });
}

function resumePending(a:Account) {
 const pending=pendingTradingSetups(a),primary=pending[0];
 // Consolidate older unpaid duplicates without deleting credentials or audit data.
 for(const record of pending.slice(1))if(canDiscardSetup(record)){
  if(isLegacyTradingAccount(a,record.id))a.outlayerLegacySetup={...a.outlayerLegacySetup,lifecycle:{phase:'discarded',at:Date.now()}};
  else a.outlayerTradingAccounts![record.id].lifecycle={phase:'discarded',at:Date.now()};
 }
 return primary;
}
export async function resumeTradingAccount(store:StateStore,session:string) {
 return store.transaction(s=>{const a=accountFor(s,session);if(!a)throw new AppError(ErrorCode.SessionExpired);const record=resumePending(a);return record?{id:record.id,name:record.name}:null;});
}

export function legacyTradingSetupStore(store:StateStore,ownerId:string):StateStore {
 const guard=(s:State)=>{if(!s.accounts[ownerId]||s.accounts[ownerId].outlayerLegacySetup?.lifecycle?.phase==='discarded')throw new AppError(ErrorCode.WalletChanged);};
 return {read:fn=>store.read(s=>{guard(s);return fn(s);}),transaction:fn=>store.transaction(s=>{guard(s);return fn(s);}),...(store.saveChallenge?{saveChallenge:store.saveChallenge.bind(store)}:{}),...(store.bindCeremony?{bindCeremony:store.bindCeremony.bind(store)}:{})};
}
