import { z } from 'zod';
import { nearRpc,nativeBalance } from './near-transactions';
import { ownerInitialization,checkPublishedOwnerCode } from './owner';
import { OUTLAYER_POLICY_CODE_HASH,OUTLAYER_POLICY_CONTRACT } from './policy-storage';
import type { ActivationPlan } from './activation-state';
async function view(accountId:string,method:string,args:unknown,fetcher:typeof fetch) {
 const r=z.object({result:z.array(z.number().int().min(0).max(255))}).parse(await nearRpc('query',{request_type:'call_function',finality:'final',account_id:accountId,method_name:method,args_base64:Buffer.from(JSON.stringify(args)).toString('base64')},fetcher));
 return JSON.parse(Buffer.from(r.result).toString('utf8')) as unknown;
}
export async function checkActivationContracts(fetcher:typeof fetch=fetch) {
 await checkPublishedOwnerCode(fetcher);
 const r=z.object({code_hash:z.literal(OUTLAYER_POLICY_CODE_HASH)}).parse(await nearRpc('query',{request_type:'view_account',finality:'final',account_id:OUTLAYER_POLICY_CONTRACT},fetcher));
 return r;
}
export async function verifyPrimaryController(controllerId:string,publicKey:string,fetcher:typeof fetch=fetch) {
 const keys=z.object({keys:z.array(z.unknown())}).parse(await nearRpc('query',{request_type:'view_access_key_list',finality:'final',account_id:controllerId},fetcher));
 if(keys.keys.length!==0||await view(controllerId,'w_public_key',{},fetcher)!==ownerInitialization(publicKey).walletPublicKey||await view(controllerId,'w_is_signature_allowed',{},fetcher)!==true)throw new Error('Controller authority verification failed.');
 if(z.array(z.string()).parse(await view(controllerId,'w_extensions',{},fetcher)).length!==0)throw new Error('Controller recovery requires review before creating another account.');
}
export async function readLockedPolicyVersion(
 controllerId: string,
 walletPublicKey: string,
 fetcher: typeof fetch = fetch,
 locked = true,
) {
 const policy = z.object({
  owner: z.literal(controllerId),
  version: z.number().int().positive().safe(),
  locked: z.literal(locked),
  frozen: z.literal(false),
 }).parse(await view(OUTLAYER_POLICY_CONTRACT, 'get_wallet_policy', {
  wallet_pubkey: `ed25519:${walletPublicKey}`,
 }, fetcher));
 return policy.version;
}

export async function verifyStoredPolicy(
 expected: { controllerId: string; walletPublicKey: string; encryptedPolicy: string; version: number; locked?: boolean },
 fetcher: typeof fetch = fetch,
) {
 return z.object({
  owner: z.literal(expected.controllerId),
  encrypted_data: z.literal(expected.encryptedPolicy),
  version: z.literal(expected.version),
  locked: z.literal(expected.locked ?? true),
  frozen: z.literal(false),
 }).parse(await view(OUTLAYER_POLICY_CONTRACT, 'get_wallet_policy', {
  wallet_pubkey: `ed25519:${expected.walletPublicKey}`,
 }, fetcher));
}

export async function verifyActivation(plan:ActivationPlan,fetcher:typeof fetch=fetch) {
 await checkActivationContracts(fetcher);
 const controllers:[string,string][]=[[plan.controllerId,plan.publicKey]];
 if(plan.recoveryControllerId&&plan.recoveryPublicKey)controllers.push([plan.recoveryControllerId,plan.recoveryPublicKey]);
 for(const [id,key] of controllers) {
  const keys=z.object({keys:z.array(z.unknown())}).parse(await nearRpc('query',{request_type:'view_access_key_list',finality:'final',account_id:id},fetcher));
  if(keys.keys.length!==0||await view(id,'w_public_key',{},fetcher)!==ownerInitialization(key).walletPublicKey||await view(id,'w_is_signature_allowed',{},fetcher)!==true)throw new Error('Controller authority verification failed.');
 }
 if(plan.recoveryControllerId) {
  const backupExtensions=z.array(z.string()).parse(await view(plan.recoveryControllerId,'w_extensions',{},fetcher));
  if(backupExtensions.length!==0)throw new Error('Recovery controller has unexpected extension authority.');
 }
 const extensions=z.array(z.string()).parse(await view(plan.controllerId,'w_extensions',{},fetcher));
 if(plan.recoveryControllerId?extensions.length!==1||extensions[0]!==plan.recoveryControllerId:extensions.length!==0)throw new Error('Recovery authority was not installed as approved.');
 const policy=await verifyStoredPolicy({...plan,version:1},fetcher);
 return {policyVersion:policy.version,recoveryInstalled:!!plan.recoveryControllerId,retainedControllerYoctoNear:(BigInt(await nativeBalance(plan.controllerId,fetcher))+(plan.recoveryControllerId?BigInt(await nativeBalance(plan.recoveryControllerId,fetcher)):BigInt(0))).toString()};
}
