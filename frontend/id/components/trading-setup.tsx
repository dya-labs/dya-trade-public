"use client";
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';
import { TradingActivation } from './trading-activation';
import { readTradingSetup,prepareOwnerCheck,verifyOwnerCheck,prepareSetupQuote } from '../lib/outlayer-client';
import { prepareActivationReview } from '../lib/outlayer-activation-client';

import { TradingAccountName } from './trading-account-name';

export function TradingSetup({accountId:initialAccountId,createNew=false,renderHeader,onOpenAccount}:{accountId?:string;createNew?:boolean;onOpenAccount?:(id:string)=>void;renderHeader?:(onBack?:()=>void)=>ReactNode}) {
 const router=useRouter();
 const [accountId,setAccountId]=useState(initialAccountId);
 return <>
    {createNew&&!accountId?<>{renderHeader?.()}<TradingAccountName onContinue={setAccountId}/></>:<TradingActivation onOpenAccount={onOpenAccount} renderHeader={renderHeader} onBack={()=>router.replace("/")} key={accountId??'legacy'} accountId={accountId} asset="USDC" ready onDiscarded={()=>router.replace("/")} onActivated={()=>{}} prepareReview={async asset=>{
     const {setup}=await readTradingSetup(accountId);
     if(setup.owner!=='verified'){
      const {options}=await prepareOwnerCheck(accountId);
      await verifyOwnerCheck(await startAuthentication({optionsJSON:options}),accountId);
     }
     const {quote}=await prepareSetupQuote(asset,accountId);
     if(quote.status!=='estimated'||!quote.actualPolicyPrepared)throw new Error(quote.status==='unavailable'?quote.reason:'Setup quote is unavailable. No payment was made.');
     return prepareActivationReview(asset,accountId);
    }}/>}
 </>;
}
