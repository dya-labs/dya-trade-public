// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createNetworkImageReader, matchNetworkImages } from "../../../backend/id/src/near/providers/network-image-suggestions";
import type { Network } from "../../../packages/wallet-contracts/src/domain/networks";
const image="https://coin-images.coingecko.com/asset_platforms/images/1/small/network.png";
const network=(id:string,evmChainId:number|null=null):Network=>({id,name:id,iconUrl:"",explorerUrl:"",evmChainId,addressKind:"provider",status:"pending",deposits:false,withdrawals:false,discoveredAt:0,updatedAt:0,revision:0});
const platform=(id:string,chain_identifier:number|null=null,url=image)=>({id,chain_identifier,image:{small:url}});
it('suggests images only for exact platform aliases or unique configured EVM chain IDs',()=>{
 const rows=[network('hood'),network('unichain'),network('custom-provider-id',130),network('guess-by-name')];rows[3]!.name='Unichain';
 expect(matchNetworkImages(rows,[platform('robinhood',4663),platform('unichain',130)])).toEqual({hood:image,unichain:image,'custom-provider-id':image});
 expect(rows.every(n=>n.status==='pending'&&!n.deposits&&!n.withdrawals&&!n.iconUrl)).toBe(true);
});
it('preserves custom images and rejects ambiguous, mismatched and unsafe metadata',()=>{
 expect(matchNetworkImages([{...network('hood'),iconUrl:'https://example.test/custom.png'}],[platform('robinhood',4663)])).toEqual({});
 expect(matchNetworkImages([network('hood',1)],[platform('robinhood',4663)])).toEqual({});
 expect(matchNetworkImages([network('unknown',130)],[platform('first',130),platform('second',130)])).toEqual({});
 for(const url of ['http://coin-images.coingecko.com/icon.png','https://evil.example/icon.png','https://user:password@coin-images.coingecko.com/icon.png']) expect(matchNetworkImages([network('unichain')],[platform('unichain',130,url)])).toEqual({});
});
it('deduplicates public metadata requests, caches them and skips fetching when all images are configured',async()=>{
 const fetcher=vi.fn(async()=>Response.json([platform('unichain',130)]));const read=createNetworkImageReader(fetcher,()=>1000);
 await Promise.all([read([network('unichain')]),read([network('unichain')])]);expect(fetcher).toHaveBeenCalledOnce();
 expect(await read([network('unichain')])).toEqual({unichain:image});expect(fetcher).toHaveBeenCalledOnce();
 expect(await read([{...network('unichain'),iconUrl:'https://example.test/custom.png'}])).toEqual({});expect(fetcher).toHaveBeenCalledOnce();
});
it('keeps review usable during CoinGecko failures with previously verified images and retry cooldown',async()=>{
 const fetcher=vi.fn(async()=>{throw new Error('offline');});const read=createNetworkImageReader(fetcher,()=>1000);
 expect((await read([network('hood'),network('unknown')])).hood).toContain('robinhood.png');
 expect((await read([network('unknown')])).unknown).toBeUndefined();expect(fetcher).toHaveBeenCalledOnce();
});
