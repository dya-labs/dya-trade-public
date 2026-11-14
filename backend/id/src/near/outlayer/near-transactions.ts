import { createHash, createHmac, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { base58 } from '@scure/base';
import { z } from 'zod';
import { publicRpc } from '../auth/intents';
import { providerFetch } from '../providers/http';
import { relayerPublicConfiguration } from './relayer';

export const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
export const u64=(n:string|number|bigint)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
export const u128=(n:string|bigint)=>{const v=BigInt(n);return Buffer.concat([u64(v&((BigInt("1")<<BigInt("64"))-BigInt("1"))),u64(v>>BigInt("64"))]);};
export const text=(s:string)=>Buffer.concat([u32(Buffer.byteLength(s)),Buffer.from(s)]);
const keyFor=(seed:string)=>createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(seed,'hex')]),format:'der',type:'pkcs8'});
export function payerPublic(seed:string) {
 if(!/^[0-9a-f]{64}$/.test(seed))throw new Error('Invalid setup payer key.');
 const bytes=createPublicKey(keyFor(seed)).export({format:'der',type:'spki'}).subarray(-32);
 return {accountId:bytes.toString('hex'),publicKey:`ed25519:${base58.encode(bytes)}`};
}
/** One isolated payer per setup; seed is persisted only in encrypted account history. */
export function createSetupPayer(id:string) {
 if(!/^[0-9a-f-]{36}$/.test(id)||!relayerPublicConfiguration())throw new Error('Setup payer is unavailable.');
 const root=base58.decode(process.env.OUTLAYER_RELAYER_PRIVATE_KEY!.slice(8));
 const seed=createHmac('sha256',root.subarray(0,32)).update(`dya-outlayer-setup-payer-v1:${id}`,'utf8').digest('hex');
 const key=keyFor(seed),probe=Buffer.from('dya-setup-signer-preflight-v1');
 if(!verify(null,probe,createPublicKey(key),sign(null,probe,key)))throw new Error('Setup signer is unavailable.');
 return {seed,...payerPublic(seed)};
}
/** Use the configured sponsor for owner-authorized policy filing only. */
export function policyFilingSponsor() {
 const sponsor = relayerPublicConfiguration();
 if (!sponsor) throw new Error("Policy filing sponsor is unavailable.");
 const seed = Buffer.from(base58.decode(process.env.OUTLAYER_RELAYER_PRIVATE_KEY!.trim().slice(8))).subarray(0, 32).toString("hex");
 if (payerPublic(seed).accountId !== sponsor.accountId) throw new Error("Policy filing sponsor changed.");
 return { seed, ...sponsor };
}

export async function nearRpc(method:string,params:unknown,fetcher:typeof fetch=fetch) {
 const response=await publicRpc(JSON.stringify({jsonrpc:'2.0',id:'outlayer-activation',method,params}),fetcher);
 const value=z.object({result:z.unknown().optional(),error:z.unknown().optional()}).parse(await response.json());
 if(!response.ok||value.error||value.result===undefined)throw new Error('Mainnet setup RPC is unavailable.');
 return value.result;
}
export async function nativeBalance(accountId:string,fetcher:typeof fetch=fetch) {
 const response=await publicRpc(JSON.stringify({jsonrpc:'2.0',id:'setup-native-balance',method:'query',params:{request_type:'view_account',finality:'final',account_id:accountId}}),fetcher);
 const body=z.object({result:z.unknown().optional(),error:z.object({cause:z.object({name:z.string()}).passthrough().optional()}).passthrough().optional()}).parse(await response.json());
 if(response.ok&&body.error?.cause?.name==='UNKNOWN_ACCOUNT')return '0';
 if(!response.ok||body.error)throw new Error('Native setup balance could not be confirmed.');
 return z.object({amount:z.string().regex(/^[0-9]+$/)}).parse(body.result).amount;
}
export type SetupAction = {kind:'init';stateInitBase64:string;deposit:string}|{kind:'transfer';amount:string}|{kind:'call';method:string;argsBase64:string;gas:string;deposit:string};
export function actionBytes(action:SetupAction) {
 if(action.kind==='init')return Buffer.concat([Buffer.from([11]),Buffer.from(action.stateInitBase64,'base64'),u128(action.deposit)]);
 if(action.kind==='transfer')return Buffer.concat([Buffer.from([3]),u128(action.amount)]);
 const args=Buffer.from(action.argsBase64,'base64');
 if(BigInt(action.gas)>BigInt("300000000000000"))throw new Error('Setup gas limit exceeded.');
 return Buffer.concat([Buffer.from([2]),text(action.method),u32(args.length),args,u64(action.gas),u128(action.deposit)]);
}
export async function signSetupTransaction(seed:string,receiverId:string,action:SetupAction,gasPriceCap:string,fetcher:typeof fetch=fetch) {
 const payer=payerPublic(seed);
 const block=z.object({header:z.object({hash:z.string(),gas_price:z.string(),height:z.number()})}).parse(await nearRpc('block',{finality:'final'},fetcher));
 const pricing=z.object({protocol_version:z.literal(88),runtime_config:z.object({min_gas_purchase_price:z.string()})}).parse(await nearRpc('EXPERIMENTAL_protocol_config',{block_id:block.header.hash},fetcher));
 if(BigInt(block.header.gas_price)>BigInt(gasPriceCap)||BigInt(pricing.runtime_config.min_gas_purchase_price)>BigInt(gasPriceCap))throw new Error('Setup gas price exceeds the approved cap.');
 const access=z.object({nonce:z.number().int().nonnegative().safe(),permission:z.literal('FullAccess')}).parse(await nearRpc('query',{request_type:'view_access_key',block_id:block.header.hash,account_id:payer.accountId,public_key:payer.publicKey},fetcher));
 const tx=Buffer.concat([text(payer.accountId),Buffer.from([0]),Buffer.from(payer.accountId,'hex'),u64(BigInt(access.nonce)+BigInt("1")),text(receiverId),base58.decode(block.header.hash),u32(1),actionBytes(action)]);
 const digest=createHash('sha256').update(tx).digest();
 return {hash:base58.encode(digest),bytes:Buffer.concat([tx,Buffer.from([0]),sign(null,digest,keyFor(seed))]).toString('base64'),signerId:payer.accountId,receiverId};
}
export async function broadcastSetupTransaction(bytes:string,fetcher:typeof fetch=fetch) {
 // A single submission. A lost response is reconciled by hash, never a new nonce.
 const response=await providerFetch(fetcher,'https://rpc.mainnet.fastnear.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'outlayer-setup-send',method:'send_tx',params:{signed_tx_base64:bytes,wait_until:'NONE'}})});
 if(!response.ok)throw new Error('Setup transaction submission is unconfirmed.');
}
export async function transactionStatus(hash:string,signerId:string,fetcher:typeof fetch=fetch):Promise<'pending'|'success'|'failed'> {
 try {
  const value=z.object({final_execution_status:z.string(),status:z.unknown(),transaction:z.object({hash:z.string(),signer_id:z.string()}),receipts_outcome:z.array(z.object({outcome:z.object({status:z.unknown()})}))}).parse(await nearRpc('tx',{tx_hash:hash,sender_account_id:signerId,wait_until:'NONE'},fetcher));
  if(value.transaction.hash!==hash||value.transaction.signer_id!==signerId)throw new Error('Transaction identity mismatch.');
  if(value.final_execution_status!=='FINAL')return 'pending';
  const statuses=[value.status,...value.receipts_outcome.map(r=>r.outcome.status)];
  return statuses.some(s=>s&&typeof s==='object'&&'Failure' in s)?'failed':statuses[0]&&typeof statuses[0]==='object'&&'SuccessValue' in statuses[0]?'success':'pending';
 } catch {return 'pending';}
}
