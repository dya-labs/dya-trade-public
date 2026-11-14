import { randomBytes } from 'node:crypto';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { base58 } from '@scure/base';
import { p256 } from '@noble/curves/nist.js';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { text,u32,u64,u128 } from './near-transactions';
export type OwnerRequest = {
 chain_id:'mainnet';signer_id:string;nonce:number;created_at:string;timeout_secs:number;
 request:{internal:{op:'add_extension';payload:{account_id:string}}[];external:{receiver_id:string;actions:{action:'function_call';payload:{function_name:string;args:string;deposit:string;gas:string}}[]}[]};
};
export function ownerRequest(controllerId:string,recoveryId:string|undefined,policyCall:Record<string,unknown>,storageDeposit:string,now=Date.now()):OwnerRequest {
 return {chain_id:'mainnet',signer_id:controllerId,nonce:randomBytes(4).readUInt32LE(),created_at:new Date(now-1000).toISOString(),timeout_secs:3600,request:{internal:recoveryId?[{op:'add_extension',payload:{account_id:recoveryId}}]:[],external:[{receiver_id:'outlayer.near',actions:[{action:'function_call',payload:{function_name:'store_wallet_policy',args:Buffer.from(JSON.stringify(policyCall)).toString('base64'),deposit:storageDeposit,gas:'100000000000000'}}]}]}};
}
export function ownerRequestHash(msg:OwnerRequest) {
 const vector=(items:Uint8Array[])=>Buffer.concat([u32(items.length),...items]);
 const encoded=Buffer.concat([Buffer.from([0]),text(msg.chain_id),text(msg.signer_id),u32(msg.nonce),u64(BigInt(Date.parse(msg.created_at))*BigInt("1000000")),u32(msg.timeout_secs),vector(msg.request.internal.map(op=>Buffer.concat([Buffer.from([1]),text(op.payload.account_id)]))),vector(msg.request.external.map(p=>Buffer.concat([text(p.receiver_id),Buffer.from([0]),vector(p.actions.map(a=>{const args=Buffer.from(a.payload.args,'base64');return Buffer.concat([Buffer.from([2]),text(a.payload.function_name),u32(args.length),args,u128(a.payload.deposit),u64(a.payload.gas),u64(1)]);} ))])))]);
 // Workerd's node:crypto does not implement SHA3. Keep the contract's exact
 // SHA3-256 digest (not Keccak-256), using the portable implementation.
 return Buffer.from(sha3_256(Buffer.concat([Buffer.from('NEAR_WALLET_CONTRACT/V1'),encoded])));
}
export function ownerProof(assertion:AuthenticationResponseJSON) {
 const signature=p256.Signature.fromBytes(Buffer.from(assertion.response.signature,'base64url'),'der');
 const order=p256.Point.Fn.ORDER;
 const normalized=new p256.Signature(signature.r,signature.s>order/BigInt("2")?order-signature.s:signature.s);
 return JSON.stringify({authenticator_data:assertion.response.authenticatorData,client_data_json:Buffer.from(assertion.response.clientDataJSON,'base64url').toString('utf8'),signature:`p256:${base58.encode(normalized.toBytes('compact'))}`});
}

export type ControllerApproval = {
 chain_id: 'mainnet';
 signer_id: string;
 path: [];
 timestamp: string;
 payload: string;
};

export function controllerApprovalHash(message: ControllerApproval) {
 const encoded = Buffer.concat([
  text(message.chain_id), text(message.signer_id), u32(message.path.length),
  u64(BigInt(Date.parse(message.timestamp)) * BigInt(1000000)), text(message.payload),
 ]);
 return Buffer.from(sha3_256(Buffer.concat([Buffer.from('NEAR_NEP641_OFFCHAIN_MESSAGE/V1'), encoded])));
}

export function controllerApprovalProof(message: ControllerApproval, assertion: AuthenticationResponseJSON) {
 return JSON.stringify({ signature: { msg: message, proof: ownerProof(assertion) } });
}
