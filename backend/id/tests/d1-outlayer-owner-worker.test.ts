import { expect,test } from 'vitest';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { ownerRequestHash,type OwnerRequest } from '../src/near/outlayer/owner-request';

test('owner approval uses the contract SHA3 digest in the actual Worker runtime',async()=>{
 const msg:OwnerRequest={chain_id:'mainnet',signer_id:'controller.near',nonce:1,created_at:'2026-11-14T00:00:00.000Z',timeout_secs:3600,request:{internal:[],external:[]}};
 // Independent empty-request Borsh vector, hashed with Node's native SHA3.
 const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
 const text=(s:string)=>Buffer.concat([u32(Buffer.byteLength(s)),Buffer.from(s)]);
 const timestamp=Buffer.alloc(8);timestamp.writeBigUInt64LE(BigInt(Date.parse(msg.created_at))*1000000n);
 const expected=createHash('sha3-256').update(Buffer.concat([Buffer.from('NEAR_WALLET_CONTRACT/V1'),Buffer.from([0]),text('mainnet'),text('controller.near'),u32(1),timestamp,u32(3600),u32(0),u32(0)])).digest('hex');
 expect(ownerRequestHash(msg).toString('hex')).toBe(expected);
 const path=fileURLToPath(new URL('../src/near/outlayer/owner-request.ts',import.meta.url));
 const result=await build({stdin:{contents:`import {Buffer} from 'node:buffer'; import {ownerRequestHash} from ${JSON.stringify(path)}; globalThis.Buffer=Buffer; export default {fetch(){return new Response(ownerRequestHash(${JSON.stringify(msg)}).toString('hex'));}};`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'browser',target:'es2023',external:['node:*','cloudflare:*'],logLevel:'silent'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat']}));
 try {const response=await mf.dispatchFetch('http://local/');expect(response.status).toBe(200);expect(await response.text()).toBe(expected);}finally{await mf.dispose();}
});
