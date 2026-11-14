import { createHash,randomUUID } from 'node:crypto';
import type { Account } from '../repositories/store';
import { accountIdentity } from '../auth/intents';
import { prepareInitialPolicyWrite } from './setup-draft';
import { estimatePolicyStorage,OUTLAYER_POLICY_CODE_HASH } from './policy-storage';
import { readSetupNetworkPricing } from './network-pricing';
import { ownerInitialization,checkPublishedOwnerCode } from './owner';
import { verifyPrimaryController } from './activation-checks';
import { nativeBalance } from './near-transactions';
import { createSetupPayer } from './near-transactions';
import { prepareSetupPayment } from './setup-payment';
import { activationOperationSchema,type ActivationOperation } from './activation-state';

export async function prepareActivation(account:Account,asset:'USDC'|'NEAR',fetcher:typeof fetch=fetch,now=Date.now()):Promise<ActivationOperation> {
 const draft=account.outlayerSetupDraft;
 if(!account.publicKey||!account.credentialId||draft?.phase!=='policy-ready')throw new Error('Verify your passkey and prepare the policy draft first.');
 const primary=ownerInitialization(account.publicKey);
 if(draft.controllerId!==primary.controllerId)throw new Error('Setup controller binding changed.');
 await checkPublishedOwnerCode(fetcher);
 const signed=await prepareInitialPolicyWrite(account.id,draft,fetcher,now);
 const pricing=await readSetupNetworkPricing(fetcher);
 const storage=await estimatePolicyStorage({walletPublicKey:draft.walletPublicKey,encryptedPolicy:draft.encryptedPolicy},fetcher);
 const id=randomUUID(),payer=createSetupPayer(id);
 const reserve=(BigInt("770")*BigInt(pricing.storagePricePerByteYoctoNear)).toString();
 // Single-controller pilot: 100 Tgas for initialization, 300 for the relay,
 // and 50 for refund. Recovery can be installed in a later owner-approved flow.
 const existingBalance=BigInt(await nativeBalance(primary.controllerId,fetcher));
 const existingController=existingBalance>BigInt(0);
 if(existingController)await verifyPrimaryController(primary.controllerId,account.publicKey,fetcher);
 const controllerFunding=existingController?(BigInt(reserve)>existingBalance?BigInt(reserve)-existingBalance:BigInt(0)).toString():reserve;
 const gasReserve=BigInt(existingController?'350000000000000':'450000000000000')*BigInt(pricing.gasPurchasePriceYoctoNear);
 const initialization=(BigInt(pricing.accountCreationChargeYoctoNear)+BigInt(reserve)).toString();
 const required=((existingController?BigInt(0):BigInt(initialization))+BigInt(controllerFunding)+BigInt(storage.yoctoNear)+gasReserve).toString();
 const source=accountIdentity(account).accountId;
 const payment=await prepareSetupPayment({asset,accountId:source,payer:payer.accountId,outputYoctoNear:required},process.env.ONE_CLICK_JWT??'',fetcher,now);
 const plan={accountId:account.id,credentialId:account.credentialId,publicKey:account.publicKey,draftId:draft.id,walletId:draft.walletId,walletPublicKey:draft.walletPublicKey,controllerId:primary.controllerId,codeHash:primary.codeHash,policyContractHash:OUTLAYER_POLICY_CODE_HASH,encryptedPolicy:draft.encryptedPolicy,policyHash:draft.policyHash,policyCall:signed,policyStorage:storage.yoctoNear,controllerReserve:controllerFunding,gasPriceCap:pricing.gasPurchasePriceYoctoNear,requiredYoctoNear:required,payer:payer.accountId,asset,sourceAccountId:source,sourceAssetId:payment.sourceAssetId,costs:{initializationMax:existingController?"0":initialization,controllerBalances:controllerFunding,policyStorage:storage.yoctoNear,gasReserve:gasReserve.toString()},maximumPaymentRaw:payment.maxInputRaw,expiresAt:payment.expiresAt,paymentPayload:payment.payload,paymentChallenge:payment.challenge,depositAddress:payment.depositAddress,deliveryAppFeeBps:payment.appFeeBps,steps:existingController?[]:[
 {receiverId:primary.controllerId,action:{kind:'init' as const,stateInitBase64:primary.stateInitBase64,deposit:initialization}},
 ]};
 return activationOperationSchema.parse({id,planHash:createHash('sha256').update(JSON.stringify(plan)).digest('hex'),plan,payerSeed:payer.seed,createdAt:now,transactions:[],refundedYoctoNear:'0',phase:'review'});
}
