import { z } from 'zod';
import { verifyQuoteSignature,type OneClickQuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { providerFetch,ONE_CLICK_BASE,oneClickHeaders } from '../providers/http';
import { TOKENS } from '../../../../../packages/wallet-contracts/src/domain/assets';
import type { RefundRoute } from './activation-state';
export async function prepareSetupRefund(payer:string,recipient:string,amount:string,jwt:string,fetcher:typeof fetch=fetch,now=Date.now(),verify=verifyQuoteSignature):Promise<RefundRoute> {
 const request={dry:false,confidentiality:'advanced',swapType:'EXACT_INPUT',slippageTolerance:100,originAsset:TOKENS.wNEAR.assetId,destinationAsset:TOKENS.wNEAR.assetId,amount,depositType:'ORIGIN_CHAIN',refundType:'ORIGIN_CHAIN',refundTo:payer,recipientType:'CONFIDENTIAL_INTENTS',recipient,deadline:new Date(now+300000).toISOString(),quoteWaitingTimeMs:3000,appFees:[]};
 const r=await providerFetch(fetcher,`${ONE_CLICK_BASE}/v0/quote`,{method:'POST',headers:oneClickHeaders(jwt),body:JSON.stringify(request)});
 if(!r.ok)throw new Error('Refund route is unavailable; unused NEAR remains claimable.');
 const raw=z.string().regex(/^[1-9][0-9]{0,77}$/);
 const result=z.object({timestamp:z.string(),quoteRequest:z.record(z.string(),z.unknown()),quote:z.object({depositAddress:z.string().min(2).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),depositMemo:z.unknown().optional(),amountIn:raw,amountOut:raw,minAmountOut:raw,deadline:z.string().optional()}).passthrough()}).passthrough().parse(await r.json());
 if(!verify(result as unknown as OneClickQuoteResponse))throw new Error('Refund quote signature is invalid.');
 for(const [key,value] of Object.entries(request))if(key!=='appFees'&&result.quoteRequest[key]!==value)throw new Error('Refund quote differs from the approved route.');
 const fees=z.array(z.object({recipient:z.string(),fee:z.number().int().min(0).max(20)})).max(32).parse(result.quoteRequest.appFees??[]);
 const bps=fees.reduce((s,f)=>s+f.fee,0);
 if(bps>20||new Set(fees.map(f=>f.recipient)).size!==fees.length||result.quote.amountIn!==amount||result.quote.depositMemo!=null||BigInt(result.quote.minAmountOut)>BigInt(result.quote.amountOut))throw new Error('Refund amount or fees are invalid.');
 if(BigInt(result.quote.minAmountOut)*BigInt(10000)<BigInt(amount)*BigInt(9880))throw new Error('Refund costs exceed the approved total fee and slippage ceiling.');
 const stamp=Date.parse(result.timestamp),expiresAt=Math.min(stamp+60000,Date.parse(request.deadline),result.quote.deadline?Date.parse(result.quote.deadline):Infinity);
 if(stamp>now+5000||!Number.isFinite(expiresAt)||expiresAt<=now+15000)throw new Error('Refund quote expired.');
 return {depositAddress:result.quote.depositAddress,amountIn:amount,minAmountOut:result.quote.minAmountOut,expiresAt,appFeeBps:bps};
}
