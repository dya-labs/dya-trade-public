import { expect,test,vi } from 'vitest';
import { prepareSetupPayment } from '../src/near/outlayer/setup-payment';
import { prepareSetupRefund } from '../src/near/outlayer/setup-refund';
import { PRIVATE_SALT,PRIVATE_VERIFIER,privateAssetId } from '../../../packages/wallet-contracts/src/domain/confidential';
import { TOKENS } from '../../../packages/wallet-contracts/src/domain/assets';
const now=1800000000000,input={asset:'USDC' as const,accountId:`0x${'a'.repeat(40)}`,payer:'b'.repeat(64),outputYoctoNear:'1000000000000000000000000'};
function remote(change:(p:Record<string,unknown>)=>void=()=>{}) {
 return vi.fn<typeof fetch>(async(url,init)=>{
  if(String(url).endsWith('/quote')){const request=JSON.parse(String(init?.body));expect(request.dry).toBe(false);return Response.json({timestamp:new Date(now).toISOString(),quoteRequest:{...request,appFees:[{recipient:'fees.near',fee:20}]},quote:{depositAddress:'deposit.near',amountIn:'2000000',amountOut:input.outputYoctoNear,minAmountOut:input.outputYoctoNear}});}
  const payload:Record<string,unknown>={signer_id:input.accountId,deadline:new Date(now+300000).toISOString(),verifying_contract:PRIVATE_VERIFIER,nonce:Buffer.concat([Buffer.from(`5628f6c600${PRIVATE_SALT}`,'hex'),Buffer.alloc(23)]).toString('base64'),intents:[{intent:'transfer',receiver_id:'deposit.near',tokens:{[privateAssetId(TOKENS.USDC.assetId)]:'2000000'}}]};change(payload);return Response.json({intent:{standard:'webauthn',payload:JSON.stringify(payload)}});
 });
}
test('executable setup binds one exact confidential debit and the signed payout route',async()=>{
 const r=remote(),verify=vi.fn(()=>true);const result=await prepareSetupPayment(input,'jwt',r,now,verify);
 expect(result.maxInputRaw).toBe('2000000');expect(result.outputYoctoNear).toBe(input.outputYoctoNear);expect(result.expiresAt).toBe(now+60000);expect(verify).toHaveBeenCalledOnce();
});
test.each(['public','amount','recipient','extra'])('refuses %s alteration to the generated private payment',async change=>{
 const r=remote(p=>{if(change==='public')p.verifying_contract='intents.near';else if(change==='amount')(p.intents as {tokens:Record<string,string>}[])[0].tokens[privateAssetId(TOKENS.USDC.assetId)]='2000001';else if(change==='recipient')(p.intents as {receiver_id:string}[])[0].receiver_id='attacker.near';else (p.intents as unknown[]).push({intent:'add_public_key'});});
 await expect(prepareSetupPayment(input,'jwt',r,now,()=>true)).rejects.toThrow();
});
test('invalid provider quote signatures cannot reach intent generation',async()=>{
 const r=remote();await expect(prepareSetupPayment(input,'jwt',r,now,()=>false)).rejects.toThrow('signature');expect(r).toHaveBeenCalledTimes(1);
});
test('refunds preserve confidentiality, exact payer/source binding and a total 1.2% fee/slippage ceiling',async()=>{
 const r=vi.fn<typeof fetch>(async(_url,init)=>{const q=JSON.parse(String(init?.body));return Response.json({timestamp:new Date(now).toISOString(),quoteRequest:q,quote:{depositAddress:'refund.near',amountIn:'1000000',amountOut:'1000000',minAmountOut:'990000'}});});
 expect((await prepareSetupRefund(input.payer,input.accountId,'1000000','jwt',r,now,()=>true)).minAmountOut).toBe('990000');
 const highFee=vi.fn<typeof fetch>(async(_url,init)=>Response.json({timestamp:new Date(now).toISOString(),quoteRequest:JSON.parse(String(init?.body)),quote:{depositAddress:'refund.near',amountIn:'1000000',amountOut:'1000000',minAmountOut:'980000'}}));
 await expect(prepareSetupRefund(input.payer,input.accountId,'1000000','jwt',highFee,now,()=>true)).rejects.toThrow('ceiling');
});
