'use client';
import { DYA_WALLET_NAMES,TOAST_MESSAGES } from "@dya/config";
import { toast } from '@dya/ui/lib/toast';
import Link from 'next/link';
import { useEffect,useCallback,useState,type ReactNode } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { AlertDialogDrawer,AlertDialogDrawerContent,AlertDialogDrawerHeader,AlertDialogDrawerTitle,AlertDialogDrawerBody,AlertDialogDrawerFooter,AlertDialogDrawerCancel,AlertDialogDrawerAction } from '@dya/ui/components/alert-dialog-drawer';
import { Alert,AlertDescription } from '@dya/ui/components/alert';
import { ToastTransitionIcon } from "@dya/ui/components/toast-transition";
import { AccountAvatar } from "@dya/ui/components/account-avatar";
import { CenteredHeading } from "@dya/ui/components/centered-heading";
import { Button } from '@dya/ui/components/button';
import { FormattedNumber } from '@dya/ui/components/formatted-number';
import { Stepper } from '@dya/ui/components/stepper';
import { LoaderCircle,TriangleAlert } from '@dya/ui/icons';
import { D } from '@dya/wallet-contracts/src/domain/decimal';
import { useMachine } from '@dya/ui/hooks/use-machine';
import * as liveClient from '../lib/outlayer-activation-client';
import { nextActivationUi,activationPresentation,type ActivationRequestPurpose } from './trading-activation-machine';
import type { ActivationStatus } from "../lib/outlayer-activation-client";
import { Skeleton } from "@dya/ui/components/skeleton";
import { WalletReviewRow } from './wallet-review-summary';
type ActivationClient = Pick<typeof liveClient, 'readActivation' | 'discardSetup' | 'saveSetupPaymentAsset' | 'prepareActivationReview' | 'prepareActivationPayment' | 'submitActivationPayment' | 'prepareActivationOwner' | 'submitActivationOwner' | 'advanceActivation' | 'refundActivation' | 'rebroadcastActivation'>;
type Props={onOpenAccount?:(id:string)=>void;renderHeader?:(onBack:()=>void)=>ReactNode;onBack?:()=>void;client?:ActivationClient;asset:'USDC'|'NEAR';ready:boolean;onActivated:()=>void;accountId?:string;onDiscarded?:()=>void;prepareReview?:(asset:'USDC'|'NEAR')=>Promise<ActivationStatus>};
export function TradingActivation({asset,ready,onActivated,accountId,prepareReview,onDiscarded,renderHeader,onBack,onOpenAccount,client=liveClient}:Props) {
 const [state,send]=useMachine(nextActivationUi,{phase:'loading'});
 const view=activationPresentation(state),op=view.op,selectedAsset=state.asset??op?.asset??asset;
 const active=op?.outcome==='active',review=!op||op.phase==='review';
 const choosingToken=review&&(!op||op.asset!==selectedAsset);
 const refreshingQuote=state.phase==='busy'&&state.purpose==='quote'&&op?.phase==='review';
 const preparingSetup = state.phase === 'busy' && state.purpose === 'quote' && !op;
 const loadingQuote = preparingSetup || refreshingQuote;
 const currentQuote=!refreshingQuote&&op?.phase==='review'&&op.asset===selectedAsset&&op.expiresAt>(state.observedAt??Infinity);
 useEffect(()=>{
  if(state.phase!=='loading')return;
  const id=crypto.randomUUID();if(!send({type:'request',id}))return;
  void client.readActivation(accountId).then(status=>send({type:'received',id,status,now:Date.now()})).catch(()=>send({type:'failed',id,now:Date.now(),message:'Couldn’t load setup. Refresh to continue.'}));
 },[state.phase,send,accountId,client]);
 useEffect(()=>{
  if(!view.poll||!op)return;
  const timer=setTimeout(()=>{
   const id=crypto.randomUUID();if(!send({type:'request',id}))return;
   void client.advanceActivation(op.id,accountId).then(status=>{send({type:'received',id,status,now:Date.now()});if(status.activation?.outcome==='active'&&op.outcome!=='active')onActivated();}).catch(error=>send({type:'failed',id,now:Date.now(),message:error instanceof Error?error.message:'Setup status is unavailable.'}));
  },2000);
  return ()=>clearTimeout(timer);
 },[view.poll,op,send,onActivated,accountId,client]);
 const act=useCallback(async (action:()=>Promise<ActivationStatus | undefined>,purpose?:ActivationRequestPurpose) => {
  const id=crypto.randomUUID();if(!send({type:'request',id,purpose}))return;
  try {const status=await action();if(!status){if(send({type:'cancelled',id}))toast(TOAST_MESSAGES.confirmationCancelled);return;}send({type:'received',id,status,now:Date.now()});if(status.discarded)onDiscarded?.();if(status.activation?.outcome==='active'&&op?.outcome!=='active')onActivated();}
  catch(error){send({type:'failed',id,now:Date.now(),message:error instanceof Error&&error.name==='NotAllowedError'?'Passkey confirmation cancelled. You can continue when ready.':error instanceof Error?error.message:'Couldn’t continue. Refresh status before retrying.'});}
 },[send,op,onDiscarded,onActivated]);
 const requestQuote=useCallback(async()=>{
  const status=await (prepareReview?prepareReview(selectedAsset):client.prepareActivationReview(selectedAsset,accountId));
  if(status.pilotEnabled&&(!status.activation||status.activation.phase==='review'&&(status.activation.asset!==selectedAsset||status.activation.expiresAt<=Date.now())))throw new Error('Setup quote is unavailable. No payment was made.');
  return status;
 },[prepareReview,selectedAsset,accountId,client]);
 useEffect(()=>{
  if(ready&&state.phase==='ready'&&state.picker!=='open'&&view.status?.pilotEnabled&&choosingToken)void act(requestQuote,'quote');
 },[ready,state.phase,state.picker,view.status,choosingToken,act,requestQuote]);
 const refreshQuote=useCallback(()=>void act(requestQuote,'quote'),[act,requestQuote]);
 useEffect(()=>{
  if(!ready||state.phase!=='ready'||!view.status?.pilotEnabled||op?.phase!=='review'||choosingToken)return;
  const timer=setTimeout(refreshQuote,Math.max(0,op.expiresAt-Date.now()));
  return ()=>clearTimeout(timer);
 },[ready,state.phase,view.status,op,choosingToken,refreshQuote]);
 const header=renderHeader?.(()=>{
  if(view.busy)return;
  if(accountId&&view.status?.canDiscard&&review){send({type:'discard'});return;}
  onBack?.();
 });
 if(view.status&&!view.status.pilotEnabled)return <>{header}<p className="text-sm text-muted-foreground">Account creation is unavailable.</p></>;
 const near=(value:string)=>new D(value).div(new D(10).pow(24)).toFixed();
 const claimingRefund = op?.phase === 'refund' && (
  (state.phase === 'busy' && state.purpose === 'claim-refund') ||
  (op.refundPhase !== 'owed' && !view.error)
 );
 const details=op&&!review&&(claimingRefund||op.refundPhase==='owed'||op.transactionPending)&&<div className="space-y-3 text-sm">
   {op.phase==='refund'&&(claimingRefund||op.refundPhase==='owed')&&<>
    {!claimingRefund&&op.reason&&<p className="text-muted-foreground">{op.reason}</p>}
    <Button variant="outline" className="w-full" disabled={view.busy||claimingRefund}
     onClick={()=>void act(()=>client.refundActivation(op.id,accountId),'claim-refund')}>
     {claimingRefund?<><LoaderCircle className="animate-spin" aria-hidden="true"/><span role="status">Claiming refund…</span></>:<>Claim refund ({near(op.refundOwedYoctoNear??'0')} NEAR)</>}
    </Button>
   </>}
   {op.transactionPending&&<Button variant="outline" disabled={view.busy} onClick={()=>void act(()=>client.rebroadcastActivation(op.id,accountId))}>Resend the same signed transaction</Button>}
  </div>;
 const activationTitle = active ? 'Your account is ready'
  : op?.phase === 'await-owner' ? 'Confirm account activation'
  : op?.phase === 'running' ? 'Activating your account'
  : op?.phase === 'payment-underfunded' ? 'Payment was below the required amount'
  : op?.phase === 'payment-review' ? 'Payment needs a status check'
  : op?.phase === 'payment-pending' || op?.phase === 'payment-confirming' ? 'Waiting for payment'
  : op?.outcome === 'failed' ? 'Setup stopped'
  : 'Check setup status';
 return <>{header}<section className="min-w-0 space-y-4" aria-label="Trading account setup">
  <Stepper steps={['Setup','Review','Activate']} aria-label="Account setup steps" current={review?2:3} complete={active} loading={view.busy||!!view.poll&&!active}/>
  {!review&&<CenteredHeading
   icon={active || op?.phase === "running" || op?.phase === "payment-pending" || op?.phase === "payment-review" || op?.phase === "payment-confirming" ? <ToastTransitionIcon size="lg" complete={active}/> : <AccountAvatar seed={accountId} className="size-16"/>}
   title={<span role="status">{activationTitle}</span>}
  />}
  {view.error&&<Alert variant="destructive"><TriangleAlert aria-hidden="true"/><AlertDescription>{view.error}</AlertDescription></Alert>}
  {review&&<>
   {(currentQuote||loadingQuote)?<div className="space-y-3">
    <div className="flex justify-center py-2">
     {preparingSetup ? <span aria-hidden="true"><ToastTransitionIcon size="lg" complete={false}/></span> : <AccountAvatar seed={accountId} className="size-16"/>}
    </div>
    <dl className="space-y-2 text-sm">
     <WalletReviewRow label="Setup fees">
      <Skeleton loading={loadingQuote}>{op ? <FormattedNumber value={new D(op.maximumPaymentRaw).div(new D(10).pow(op.paymentDecimals)).toFixed()} symbol={op.asset} format="exact" exactTooltip/> : <span aria-hidden="true" className="inline-block w-24"> </span>}</Skeleton>
     </WalletReviewRow>
     <WalletReviewRow label="Quote expires"><Skeleton loading={loadingQuote}>{loadingQuote||!op?<span className="tabular-nums">0:00</span>:<QuoteCountdown expiresAt={op.expiresAt}/>}</Skeleton></WalletReviewRow>
    </dl>
   </div>:choosingToken&&!op&&<p className="text-sm text-muted-foreground">Pay with {selectedAsset} from {DYA_WALLET_NAMES.main}.</p>}
   {!choosingToken&&currentQuote&&op?<Button className="w-full" disabled={view.busy} onClick={()=>{if(Date.now()>=op.expiresAt){refreshQuote();return;}void act(async()=>{const result=await client.prepareActivationPayment(op.id,accountId);const credential = await startAuthentication({optionsJSON:result.options}).catch(error => {
    if(error instanceof Error && error.name === 'NotAllowedError') return undefined;
    throw error;
   });return credential ? client.submitActivationPayment(credential,accountId) : undefined;});}}>{view.busy&&<LoaderCircle className="animate-spin"/>}Pay and continue</Button>:refreshingQuote?<Button className="w-full" disabled><LoaderCircle className="animate-spin" aria-hidden="true"/><span role="status">Refreshing quote…</span></Button>:view.busy?<Button className="w-full" disabled><LoaderCircle className="animate-spin" aria-hidden="true"/><span role="status">Preparing setup…</span></Button>:view.status?.pilotEnabled&&ready?<Button className="w-full" onClick={refreshQuote}>{view.error?'Retry setup cost':'Refresh setup cost'}</Button>:null}
   {(currentQuote||refreshingQuote)&&<p className="text-center text-xs text-muted-foreground">Fees included. Unused funds return to {DYA_WALLET_NAMES.main} in NEAR.</p>}
  </>}
  {op?.phase==='await-owner'&&<Button className="w-full" disabled={view.busy} onClick={()=>void act(async()=>{const result=await client.prepareActivationOwner(op.id,accountId);return client.submitActivationOwner(await startAuthentication({optionsJSON:result.options}),accountId);})}>{view.busy&&<LoaderCircle className="animate-spin"/>}Activate account</Button>}
  {(op?.phase==='payment-pending'||op?.phase==='payment-review'||op?.phase==='payment-confirming'||op?.phase==='running')&&!view.error&&
   <Button className="w-full" disabled><LoaderCircle className="animate-spin" aria-hidden="true"/>{op.phase==='running'?'Activating account…':'Checking payment…'}</Button>}
  {op?.phase==='payment-underfunded'&&<Button className="w-full" disabled={view.busy} onClick={()=>void act(()=>client.advanceActivation(op.id,accountId))}>Check payment</Button>}
  {op?.phase==='payment-underfunded'&&<Button variant="ghost" size="sm" className="w-full text-muted-foreground" disabled={view.busy} onClick={()=>void act(()=>client.refundActivation(op.id,accountId))}>Return unused funds</Button>}
  {active&&<Button className="w-full" nativeButton={false} render={<Link href="/" onClick={()=>{if(accountId)onOpenAccount?.(accountId);}}/>}>Open account</Button>}
  {!review&&op&&!claimingRefund&&op.refundedYoctoNear!=='0'&&<p className={active ? "text-center text-xs text-muted-foreground" : "text-sm"}>Returned to {DYA_WALLET_NAMES.main}: <FormattedNumber value={near(op.refundedYoctoNear)} symbol="NEAR" format="exact" exactTooltip/></p>}
  {view.error&&(!review||currentQuote||!view.status?.pilotEnabled)&&<Button variant="outline" className="w-full" disabled={view.busy} onClick={()=>void act(()=>client.readActivation(accountId))}>Refresh status</Button>}
  <AlertDialogDrawer open={state.phase==='discard-confirm'} onOpenChange={open=>{if(!open)send({type:'dismiss-discard'});}}><AlertDialogDrawerContent><AlertDialogDrawerHeader><AlertDialogDrawerTitle>Cancel account setup?</AlertDialogDrawerTitle></AlertDialogDrawerHeader><AlertDialogDrawerBody><p className="text-sm text-muted-foreground">No payment was made.</p></AlertDialogDrawerBody><AlertDialogDrawerFooter><AlertDialogDrawerCancel>Keep going</AlertDialogDrawerCancel><AlertDialogDrawerAction onClick={()=>{if(accountId)void act(()=>client.discardSetup(accountId));}}>Cancel setup</AlertDialogDrawerAction></AlertDialogDrawerFooter></AlertDialogDrawerContent></AlertDialogDrawer>
  {details}
 </section></>;
}


function QuoteCountdown({expiresAt}:{expiresAt:number}) {
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{
  const tick=()=>setNow(Date.now());
  tick();
  const timer=setInterval(tick,250);
  return ()=>clearInterval(timer);
 },[expiresAt]);
 const seconds=Math.max(0,Math.ceil((expiresAt-now)/1000));
 return <span role="timer" className="tabular-nums">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span>;
}
