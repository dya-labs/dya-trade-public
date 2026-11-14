import type { SetupPaymentAsset } from './setup-payment-token';
export type TradingNameState={asset:SetupPaymentAsset}&({phase:'resolving'|'resolve-error'|'naming';name:string}|{phase:'creating'|'error';name:string;requestId:string}|{phase:'picking-token';name:string;requestId?:string});
type Event={type:'open-picker'}|{type:'close-picker'}|{type:'select-token';asset:SetupPaymentAsset}|{type:'resolved'}|{type:'resolve-failed'}|{type:'resolve-retry'}|{type:'name';name:string}|{type:'create';id:string}|{type:'failed';id:string};
export function nextTradingName(state:TradingNameState,event:Event):TradingNameState|undefined {
 if(event.type==='open-picker'&&(state.phase==='naming'||state.phase==='error'))return {...state,phase:'picking-token'};
 if((event.type==='close-picker'||event.type==='select-token')&&state.phase==='picking-token'){
  const asset=event.type==='select-token'?event.asset:state.asset;
  return state.requestId?{...state,asset,phase:'error',requestId:state.requestId}:{...state,asset,phase:'naming'};
 }
 if(event.type==='resolved'&&state.phase==='resolving')return {...state,phase:'naming',name:state.name};
 if(event.type==='resolve-failed'&&state.phase==='resolving')return {...state,phase:'resolve-error',name:state.name};
 if(event.type==='resolve-retry'&&state.phase==='resolve-error')return {...state,phase:'resolving',name:state.name};
 if(event.type==='name'&&(state.phase==='naming'||state.phase==='error'))return {...state,name:event.name};
 if(event.type==='create'&&(state.phase==='naming'||state.phase==='error'))return {...state,phase:'creating',name:state.name,requestId:'requestId'in state?state.requestId:event.id};
 if(event.type==='failed'&&state.phase==='creating'&&state.requestId===event.id)return {...state,phase:'error'};
}
