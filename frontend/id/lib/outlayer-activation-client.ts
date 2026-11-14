import { z } from 'zod';
import { authenticationOptions } from '@dya/wallet-contracts/src/http/schemas/account';
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser';
export const activationPublicSchema=z.object({id:z.string(),planHash:z.string(),phase:z.enum(['review','payment-pending','payment-review','payment-confirming','payment-underfunded','await-owner','running','refund','complete','review-required']),asset:z.enum(['USDC','NEAR']),maximumPaymentRaw:z.string(),paymentDecimals:z.number(),requiredYoctoNear:z.string(),costs:z.object({initializationMax:z.string(),controllerBalances:z.string(),policyStorage:z.string(),gasReserve:z.string()}),controllerId:z.string(),recoveryControllerId:z.string().optional(),expiresAt:z.number(),deliveryAppFeeBps:z.number(),refundedYoctoNear:z.string(),txHashes:z.array(z.string()),outcome:z.enum(['active','failed']).optional(),retainedControllerYoctoNear:z.string().optional(),step:z.number().optional(),transactionPending:z.boolean().optional(),refundPhase:z.enum(['needed','quoting','quoted','preparing','pending','settling','owed']).optional(),refundOwedYoctoNear:z.string().optional(),receivedYoctoNear:z.string().optional(),reason:z.string().optional()});
const status=z.object({pilotEnabled:z.boolean(),activation:activationPublicSchema.nullable(),canDiscard:z.boolean().optional(),paymentAsset:z.enum(["USDC","NEAR"]).optional(),discarded:z.boolean().optional()});
export type ActivationPublic=z.infer<typeof activationPublicSchema>;
export type ActivationStatus=z.infer<typeof status>;
async function request<T>(route:string,schema:z.ZodType<T>,body?:unknown,accountId?:string,family:'activation'|'accounts'='activation') {
 const r=await fetch(`/api/near/outlayer/${family}/${route}${accountId?`?account=${encodeURIComponent(accountId)}`:""}`,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 const value:unknown=await r.json();
 if(!r.ok)throw new Error(value&&typeof value==='object'&&'error'in value&&typeof value.error==='string'?value.error:'Setup action is unavailable. Refresh its status before retrying.');
 return schema.parse(value);
}
export const readActivation=(accountId?:string)=>request('status',status,undefined,accountId);
export const prepareActivationReview=(asset:'USDC'|'NEAR',accountId?:string)=>request('prepare',status,{asset},accountId);
export const prepareActivationPayment=(id:string,accountId?:string)=>request('payment-options',z.object({options:authenticationOptions}),{id},accountId);
export const submitActivationPayment=(assertion:AuthenticationResponseJSON,accountId?:string)=>request('pay',status,assertion,accountId);
export const prepareActivationOwner=(id:string,accountId?:string)=>request('owner-options',z.object({options:authenticationOptions}),{id},accountId);
export const submitActivationOwner=(assertion:AuthenticationResponseJSON,accountId?:string)=>request('owner-verify',status,assertion,accountId);
export const advanceActivation=(id:string,accountId?:string)=>request('advance',status,{id},accountId);
export const refundActivation=(id:string,accountId?:string)=>request('refund',status,{id},accountId);
export const rebroadcastActivation=(id:string,accountId?:string)=>request('rebroadcast',status,{id},accountId);

export const discardSetup=(accountId:string)=>request('discard',status,{},accountId,'accounts');
export const saveSetupPaymentAsset=(asset:'USDC'|'NEAR',accountId:string)=>request('payment-asset',status,{asset},accountId,'accounts');
