import { createHash,generateKeyPairSync,sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { ownerInitialization } from '../src/near/outlayer/owner';
import { payerPublic } from '../src/near/outlayer/near-transactions';
import { activationOperationSchema,type ActivationOperation } from '../src/near/outlayer/activation-state';
import { emptyState,hash,type StateStore } from '../src/near/repositories/store';
import { TOKENS } from '../../../packages/wallet-contracts/src/domain/assets';
import { PRIVATE_VERIFIER,PRIVATE_SALT,privateAssetId } from '../../../packages/wallet-contracts/src/domain/confidential';
export function activationFixture(now=Date.now()) {
 function key(id:string){const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=keys.publicKey.export({format:'jwk'});const publicKey=Buffer.from(isoCBOR.encode(new Map<number,number|Uint8Array>([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x!,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y!,'base64url'))]]))).toString('base64url');return {id,publicKey,keys};}
 const main=key('bWFpbg'),backup=key('YmFja3Vw'),primary=ownerInitialization(main.publicKey),recovery=ownerInitialization(backup.publicKey);
 const wallet=generateKeyPairSync('ed25519'),walletKey=wallet.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
 const payerSeed='01'.repeat(32),payer=payerPublic(payerSeed).accountId,encryptedPolicy=Buffer.from('synthetic encrypted policy').toString('base64'),valid_until=Math.floor(now/1000)+3600*24*7;
 const msg=`store_wallet_policy:v2:ed25519:${walletKey}:1:1:${valid_until}:${Buffer.byteLength(encryptedPolicy)}:${encryptedPolicy}:${primary.controllerId}`;
 const signature=sign(null,createHash('sha256').update(msg).digest(),wallet.privateKey).toString('hex');
 const policyCall={wallet_pubkey:`ed25519:${walletKey}`,encrypted_data:encryptedPolicy,wallet_signature:signature,version:1,locked:true,valid_until};
 const paymentPayload=JSON.stringify({signer_id:`0x${'a'.repeat(40)}`,verifying_contract:PRIVATE_VERIFIER,deadline:new Date(now+300000).toISOString(),nonce:Buffer.concat([Buffer.from(`5628f6c600${PRIVATE_SALT}`,'hex'),Buffer.alloc(23)]).toString('base64'),intents:[{intent:'transfer',receiver_id:'payment-deposit.near',tokens:{[privateAssetId(TOKENS.USDC.assetId)]:'2000000'}}]});
 const plan={accountId:'a',credentialId:main.id,publicKey:main.publicKey,recoveryCredentialId:backup.id,recoveryPublicKey:backup.publicKey,draftId:'33333333-3333-4333-8333-333333333333',walletId:'22222222-2222-4222-8222-222222222222',walletPublicKey:walletKey,controllerId:primary.controllerId,recoveryControllerId:recovery.controllerId,codeHash:primary.codeHash,policyContractHash:'pin',encryptedPolicy,policyHash:'b'.repeat(64),policyCall,policyStorage:'10000000000000000000000',controllerReserve:'7700000000000000000000',gasPriceCap:'1000000000',requiredYoctoNear:'1000000000000000000000000',payer,asset:'USDC' as const,sourceAccountId:`0x${'a'.repeat(40)}`,sourceAssetId:TOKENS.USDC.assetId,costs:{initializationMax:'0',controllerBalances:'15400000000000000000000',policyStorage:'10000000000000000000000',gasReserve:'974600000000000000000000'},maximumPaymentRaw:'2000000',expiresAt:now+60000,paymentPayload,paymentChallenge:createHash('sha256').update(paymentPayload).digest('base64url'),depositAddress:'payment-deposit.near',deliveryAppFeeBps:20,steps:[{receiverId:recovery.controllerId,action:{kind:'init' as const,stateInitBase64:recovery.stateInitBase64,deposit:'0'}},{receiverId:primary.controllerId,action:{kind:'init' as const,stateInitBase64:primary.stateInitBase64,deposit:'0'}},{receiverId:recovery.controllerId,action:{kind:'transfer' as const,amount:'7700000000000000000000'}}]};
 const op=activationOperationSchema.parse({id:'11111111-1111-4111-8111-111111111111',planHash:createHash('sha256').update(JSON.stringify(plan)).digest('hex'),plan,payerSeed,createdAt:now,transactions:[],refundedYoctoNear:'0',phase:'review'});
 let state=emptyState();
 state.accounts.a={id:'a',kind:'passkey',credentialId:main.id,publicKey:main.publicKey,counter:0,intentsAccountId:plan.sourceAccountId,outlayerOwnerCheck:{phase:'verified',credentialId:main.id,publicKey:main.publicKey,controllerId:primary.controllerId,codeHash:primary.codeHash,checkedAt:now},outlayerRecovery:{phase:'prepared',id:backup.id,publicKey:backup.publicKey,counter:0,sourceCredentialId:main.id,sourcePublicKey:main.publicKey,verifiedAt:now,authority:'full-owner'},outlayerSetupDraft:{id:plan.draftId,phase:'policy-ready',controllerId:plan.controllerId,publicKey:main.publicKey,credentialId:main.id,createdAt:now,walletId:plan.walletId,walletPublicKey:plan.walletPublicKey,sealedApiKey:'synthetic-encrypted-credential',encryptedPolicy:plan.encryptedPolicy,policyHash:plan.policyHash},outlayerActivation:op};
 state.sessions[hash('session')]={accountId:'a',expires:now+600000};
 const store:StateStore={read:fn=>fn(structuredClone(state)),transaction:fn=>{const next=structuredClone(state);const result=fn(next);state=next;return result;}};
 return {op,store,main,backup,wallet,set:async(op:ActivationOperation)=>store.transaction(s=>{s.accounts.a.outlayerActivation=op;})};
}

/** Single-controller setup; legacy two-controller fixtures remain for resume coverage. */
export async function deferRecovery(f: ReturnType<typeof activationFixture>) {
 delete f.op.plan.recoveryControllerId;
 delete f.op.plan.recoveryCredentialId;
 delete f.op.plan.recoveryPublicKey;
 f.op.plan.steps = [f.op.plan.steps[1]];
 f.op.planHash = createHash('sha256').update(JSON.stringify(f.op.plan)).digest('hex');
 await f.store.transaction(s => { delete s.accounts.a.outlayerRecovery; });
 await f.set(activationOperationSchema.parse(f.op));
 return f;
}
