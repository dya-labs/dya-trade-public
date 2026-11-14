import type { ActivationStatus } from '../lib/outlayer-activation-client';
export type ActivationRequestPurpose = 'quote' | 'claim-refund';
export type ActivationUiState=({phase:'loading'}|{phase:'ready'|'discard-confirm';status:ActivationStatus}|{phase:'busy';id:string;purpose?:ActivationRequestPurpose;status?:ActivationStatus}|{phase:'error';message:string;purpose?:ActivationRequestPurpose;status?:ActivationStatus})&{asset?:'USDC'|'NEAR';observedAt?:number;picker?:'open'|'closed'};
export type ActivationUiEvent={type:'discard'}|{type:'dismiss-discard'}|{type:'picker';state:'open'|'closed'}|{type:'asset';asset:'USDC'|'NEAR'}|{type:'request';id:string;purpose?:ActivationRequestPurpose}|{type:'cancelled';id:string}|{type:'received';id:string;status:ActivationStatus;now:number}|{type:'failed';id:string;message:string;now:number};
export function nextActivationUi(state:ActivationUiState,event:ActivationUiEvent):ActivationUiState|undefined {
 if(event.type==='discard'&&(state.phase==='ready'||state.phase==='error')&&state.status?.canDiscard)return {phase:'discard-confirm',status:state.status,asset:state.asset,observedAt:state.observedAt};
 if(event.type==='dismiss-discard'&&state.phase==='discard-confirm')return {...state,phase:'ready'};
 if(event.type==='discard'||event.type==='dismiss-discard')return;
 if(event.type==='picker'){if(state.phase==='busy'||state.phase==='loading'||state.status?.activation&&state.status.activation.phase!=='review')return;return {...state,picker:event.state};}
 if(event.type==='asset'&&(state.phase==='ready'||state.phase==='error'&&state.status)&&(!state.status?.activation||state.status.activation.phase==='review'))return {...state,phase:'ready',status:state.status!,asset:event.asset,picker:'closed'};
 if(event.type==='asset')return;
 if(event.type==='request'&&state.phase!=='busy')return {phase:'busy',id:event.id,purpose:event.purpose,asset:state.asset,observedAt:state.observedAt,...('status'in state?{status:state.status}:{})};
 if(state.phase!=='busy'||state.id!==event.id)return;
 if(event.type==='cancelled'&&state.status)return {...state,phase:'ready',status:state.status};
 if(event.type==='received')return {phase:'ready',status:event.status,asset:state.asset??event.status.paymentAsset,observedAt:event.now};
 if(event.type==='failed')return {phase:'error',purpose:state.purpose,message:event.message,status:state.status,asset:state.asset,observedAt:event.now};
}
export function activationPresentation(state:ActivationUiState) {
 const status='status'in state?state.status:undefined,op=status?.activation;
 const poll=state.phase==='ready'&&op&&(op.phase==='payment-pending'||op.phase==='payment-review'||op.phase==='payment-confirming'||op.phase==='running'||op.phase==='refund'&&op.refundPhase!=='owed');
 return {status,op,poll:!!poll,busy:state.phase==='loading'||state.phase==='busy',error:state.phase==='error'?state.message:undefined,label:!op?'Prepare payment review':op.phase==='review'?'Review setup payment':op.phase==='payment-pending'?'Checking payment settlement…':op.phase==='payment-review'?'Payment provider reported a failure. Checking its refund status…':op.phase==='payment-confirming'?'Waiting for native payment finality…':op.phase==='payment-underfunded'?'Native payment arrived below the required amount. Setup has not started.':op.phase==='await-owner'?'Payment received. Confirm controller setup.':op.phase==='running'?'Creating and verifying controllers…':op.phase==='refund'?op.outcome==='active'?(op.recoveryControllerId?'Ownership and recovery verified. Returning unused setup funds.':'Ownership verified. Returning unused setup funds.'):'Activation stopped. Returning unused setup funds.':op.phase==='complete'?op.outcome==='active'?(op.recoveryControllerId?'Ownership and recovery setup complete.':'Trading account setup complete.'):'Setup did not activate.':op.reason??'Setup needs review.'};
}
