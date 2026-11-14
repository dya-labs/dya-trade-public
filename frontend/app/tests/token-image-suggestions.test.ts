// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createTokenImageReader } from "../../../backend/id/src/near/providers/token-image-suggestions";
it('shares and caches the metadata snapshot without allowing callers to mutate the cache',async()=>{
 const reader=vi.fn(async()=>({asset:'https://coin-images.coingecko.com/icon.png'}));const read=createTokenImageReader(reader,()=>1000);
 const [first,second]=await Promise.all([read(),read()]);expect(first).toEqual(second);expect(reader).toHaveBeenCalledOnce();
 first.asset='changed';expect((await read()).asset).toBe('https://coin-images.coingecko.com/icon.png');
});
it('retains the last good images on failure and retries after cooldown',async()=>{
 let now=1000;const reader=vi.fn<()=>Promise<Record<string,string>>>().mockResolvedValueOnce({asset:'https://coin-images.coingecko.com/icon.png'}).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({asset:'https://coin-images.coingecko.com/new.png'});
 const read=createTokenImageReader(reader,()=>now);await read();now+=600001;expect((await read()).asset).toContain('icon.png');
 await read();expect(reader).toHaveBeenCalledTimes(2);now+=60001;expect((await read()).asset).toContain('new.png');
});
it('returns an empty fallback on a cold metadata outage',async()=>{
 const read=createTokenImageReader(async()=>{throw new Error('offline');},()=>1000);expect(await read()).toEqual({});
});
