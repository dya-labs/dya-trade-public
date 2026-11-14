"use client";
import { DYA_WALLET_NAMES,TOAST_MESSAGES } from "@dya/config";
import { useEffect } from 'react';
import { toast } from '@dya/ui/lib/toast';
import { Stepper } from '@dya/ui/components/stepper';
import { Button } from '@dya/ui/components/button';
import { InputGroup,InputGroupAddon,InputGroupInput } from '@dya/ui/components/input-group';
import { LoaderCircle } from '@dya/ui/icons';
import { useMachine } from '@dya/ui/hooks/use-machine';
import { nextTradingName } from './trading-create-machine';
import { createTradingAccount,resumeTradingAccount } from '../lib/outlayer-client';

import { SetupPaymentPicker,SetupPaymentTrigger } from './setup-payment-token';

export function TradingAccountName({onContinue,resume=resumeTradingAccount,createAccount=createTradingAccount}:{onContinue:(id:string)=>void;resume?:typeof resumeTradingAccount;createAccount?:typeof createTradingAccount}){
 const [state,send]=useMachine(nextTradingName,{phase:'resolving',name:'',asset:'USDC'});
 useEffect(()=>{
  if(state.phase!=='resolving')return;
  let active=true;
  void resume().then(({account})=>{if(!active)return;if(account){toast(TOAST_MESSAGES.accountDraftResumed,{id:`account-draft-resumed:${account.id}`});onContinue(account.id);}else send({type:'resolved'});}).catch(()=>{if(active)send({type:'resolve-failed'});});
  return ()=>{active=false;};
 },[state.phase,onContinue,resume,send]);
 async function create(){
  const id=state.phase==='error'?state.requestId:crypto.randomUUID();
  if(!send({type:'create',id}))return;
  try{const {account}=await createAccount(id,state.name.trim()||DYA_WALLET_NAMES.defaultTrading,state.asset);if(account.resumed)toast(TOAST_MESSAGES.accountDraftResumed,{id:`account-draft-resumed:${account.id}`});onContinue(account.id);}
  catch{send({type:'failed',id});}
 }
 if(state.phase==='resolving')return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="animate-spin"/>Checking for unfinished setup…</p>;
 if(state.phase==='resolve-error')return <section className="space-y-4"><p role="alert">Couldn’t check existing setup.</p><Button className="w-full" onClick={()=>send({type:'resolve-retry'})}>Try again</Button></section>;
 if(state.phase==='picking-token')return <SetupPaymentPicker selectedAsset={state.asset} onBack={()=>send({type:'close-picker'})} onSelect={asset=>send({type:'select-token',asset})}/>;
 return <section className="min-w-0 space-y-4" aria-label="Name Trading account">
  <Stepper steps={['Setup','Review','Activate']} current={1} aria-label="Account setup steps"/>
  <InputGroup><InputGroupAddon><label htmlFor="trading-name">Name</label></InputGroupAddon><InputGroupInput id="trading-name" placeholder={DYA_WALLET_NAMES.defaultTrading} maxLength={32} value={state.name} disabled={state.phase==='creating'} onChange={event=>send({type:'name',name:event.target.value})} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void create();}}}/></InputGroup>
  <SetupPaymentTrigger asset={state.asset} disabled={state.phase==='creating'} onClick={()=>send({type:'open-picker'})}/>
  {state.phase==='error'&&<p role="alert" className="text-sm text-destructive">Couldn’t start setup. Try again.</p>}
  <Button className="w-full" disabled={state.phase==='creating'} onClick={()=>void create()}>{state.phase==='creating'&&<LoaderCircle className="animate-spin"/>}Continue</Button>
 </section>;
}
