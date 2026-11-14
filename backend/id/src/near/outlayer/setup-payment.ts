import { verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";
import { z } from 'zod';
import { payloadChallenge } from '../auth/intents';
import { validatePrivateTransfer } from '../../../../../packages/wallet-contracts/src/domain/confidential';
import { providerFetch,ONE_CLICK_BASE,oneClickHeaders } from '../providers/http';
import { executableSetupDelivery } from './setup-delivery';
export async function prepareSetupPayment(input:Parameters<typeof executableSetupDelivery>[0],jwt:string,fetcher:typeof fetch=fetch,now=Date.now(),verify=verifyQuoteSignature) {
 const route=await executableSetupDelivery(input,jwt,fetcher,now,verify);
 if(!route.depositAddress)throw new Error('Setup payment address is missing.');
 const response=await providerFetch(fetcher,`${ONE_CLICK_BASE}/v0/generate-intent`,{method:'POST',headers:oneClickHeaders(jwt),body:JSON.stringify({type:'swap_transfer',standard:'webauthn',signerId:input.accountId,depositAddress:route.depositAddress})});
 if(!response.ok)throw new Error('Setup payment signature could not be prepared.');
 const value=z.object({intent:z.object({standard:z.literal('webauthn'),payload:z.string().min(1).max(16384)})}).parse(await response.json());
 const payload=value.intent.payload;
 const parsed=z.object({signer_id:z.literal(input.accountId),deadline:z.string()}).passthrough().parse(JSON.parse(payload));
 validatePrivateTransfer(parsed,route.depositAddress,route.sourceAssetId,route.maxInputRaw);
 const expiresAt=Math.min(route.expiresAt,Date.parse(parsed.deadline));
 if(!Number.isFinite(expiresAt)||expiresAt<=now+15000)throw new Error('Setup payment expires too soon.');
 return {...route,depositAddress:route.depositAddress,payload,challenge:payloadChallenge(payload).toString('base64url'),expiresAt};
}
