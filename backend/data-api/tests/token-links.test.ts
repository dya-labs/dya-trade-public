import { expect, test } from "bun:test";
import { mapTokenLinks, refreshTokenLinks, TOKEN_LINKS_TTL_MS } from "../src/markets/token-links";

test("keeps HTTPS websites and valid X handles; rejects unsafe or missing metadata", () => {
  expect(mapTokenLinks({ links: { homepage: ["", "javascript:alert(1)", "https://user:pass@example.com", "https://near.org"], twitter_screen_name: "NEARProtocol" } })).toEqual({ website: "https://near.org/", x: "https://x.com/NEARProtocol" });
  expect(mapTokenLinks({ links: { homepage: ["http://example.com"], twitter_screen_name: "evil.com/a" } })).toEqual({ website: null, x: null });
  expect(mapTokenLinks(null)).toEqual({ website: null, x: null });
});
test("caches absent links for one day across refresh calls and rebuilds after expiry", async () => {
  let cached: string | null = null, requests = 0, clock = 1000;
  const options = {
    catalog: { get: async () => [{ assetId: "nep141:wrap.near", symbol: "wNEAR", decimals: 24, blockchain: "near", coingeckoId: "wrapped-near" }] },
    markets: { get: async (path: string) => { requests++; expect(path).toContain("/coins/near?"); return { id: "near", links: {} }; } },
    redis: { get: async () => cached, set: async (_key: string, value: string) => { cached = value; return "OK" as const; } },
    now: () => clock,
  };
  await refreshTokenLinks(options);
  expect(JSON.parse(cached!).assets["nep141:wrap.near"]).toEqual({ website: null, x: null });
  clock += TOKEN_LINKS_TTL_MS - 1;
  await refreshTokenLinks(options);
  expect(requests).toBe(1);
  clock++;
  await refreshTokenLinks(options);
  expect(requests).toBe(2);
});
test("retains the prior snapshot on upstream failure", async () => {
  let written = false;
  await expect(refreshTokenLinks({ catalog: { get: async () => { throw new Error("offline"); } }, markets: { get: async () => null }, redis: { get: async () => JSON.stringify({ updatedAt: 1, assets: {} }), set: async () => { written = true; return "OK" as const; } }, now: () => TOKEN_LINKS_TTL_MS + 2 })).rejects.toThrow("offline");
  expect(written).toBe(false);
});

test("refreshes reviewed project links when a manual mapping changes within the daily cache",async()=>{
 let cached:string|null=null, mapping="first-coin";const requests:string[]=[];
 const options={reviewed:true,catalog:{get:async()=>[{assetId:"new:asset",symbol:"NEW",decimals:6,blockchain:"eth",coingeckoId:"wrong",coingeckoIdOverride:mapping}]},markets:{get:async(path:string)=>{requests.push(path);return {id:mapping,links:{homepage:[`https://${mapping}.example`]}};}},redis:{get:async()=>cached,set:async(_key:string,value:string)=>{cached=value;return "OK" as const;}},now:()=>1000};
 await refreshTokenLinks(options);mapping="correct-coin";await refreshTokenLinks(options);
 expect(requests).toHaveLength(2);expect(requests[1]).toContain('/coins/correct-coin?');expect(JSON.parse(cached!).assets['new:asset'].website).toBe('https://correct-coin.example/');
});
