import { describe, expect, test } from "bun:test";
import { tokenMarketsResponse } from "../src/api/server";
import { mapTokenMarket, refreshTokenMarkets, TOKEN_MARKETS_KEY, tokenMarketIds } from "../src/markets/token-markets";

const empty = { image: null, price: null, change24h: null, volume24h: null, marketCap: null };

describe("token market metadata", () => {
  test("maps each 1Click asset to a valid CoinGecko id, with wrapped NEAR shown as NEAR", () => {
    expect(tokenMarketIds([{ assetId: "z", coingeckoId: "z-coin" }, { assetId: "btc", coingeckoId: "bitcoin" }, { assetId: "wbtc", coingeckoId: "bitcoin" },
      { assetId: "nep141:wrap.near", coingeckoId: "wrapped-near" }, { assetId: "other-wrapper", coingeckoId: "wrapped-near" },
      ...[null, "", "UPPER", "with space", "x/y", "x_y", 123].map(coingeckoId => ({ assetId: `bad-${String(coingeckoId)}`, coingeckoId })),
      { coingeckoId: "no-asset" }, { assetId: "", coingeckoId: "empty-asset" }, null, {}])).toEqual({
      z: "z-coin", btc: "bitcoin", wbtc: "bitcoin", "nep141:wrap.near": "near", "other-wrapper": "wrapped-near",
    });
    expect(tokenMarketIds([])).toEqual({});
  });

  test("maps numeric fields without coercion and permits negative changes", () => {
    expect(mapTokenMarket({ current_price: 0, price_change_percentage_24h: -2, total_volume: 3, market_cap: 4 })).toEqual({ ...empty, price: 0, change24h: -2, volume24h: 3, marketCap: 4 });
    for (const value of [null, undefined, "12", NaN, Infinity, -Infinity]) {
      expect(mapTokenMarket({ current_price: value, price_change_percentage_24h: value, total_volume: value, market_cap: value })).toEqual(empty);
    }
    expect(mapTokenMarket({ current_price: -1, total_volume: -2, market_cap: -3 })).toEqual(empty);
    expect(mapTokenMarket(null)).toEqual(empty);
  });

  test("only allows HTTPS CoinGecko image hosts", () => {
    for (const host of ["coin-images.coingecko.com", "assets.coingecko.com"]) {
      const image = `https://${host}/coins/near.png`;
      expect(mapTokenMarket({ image }).image).toBe(image);
    }
    for (const image of [null, 1, "not a URL", "http://assets.coingecko.com/x", "https://evil.example/x", "https://assets.coingecko.com.evil.example/x", "https://user@assets.coingecko.com/x", "data:image/png;base64,abc"]) {
      expect(mapTokenMarket({ image }).image).toBeNull();
    }
  });

  test("publishes one full snapshot after all 250-id batches succeed", async () => {
    const tokens = [...Array.from({ length: 250 }, (_, i) => ({ assetId: `asset-${i}`, coingeckoId: `coin-${i}` })),
      { assetId: "nep141:wrap.near", coingeckoId: "wrapped-near" }, { assetId: "asset-0-bridged", coingeckoId: "coin-0" }];
    const paths: string[] = [];
    const writes: { key: string; value: string }[] = [];
    const snapshot = await refreshTokenMarkets({
      catalog: { get: async path => { expect(path).toBe(""); return tokens; } },
      markets: { get: async path => {
        expect(writes).toHaveLength(0);
        paths.push(path);
        const url = new URL(path, "https://api.coingecko.com");
        expect(url.pathname).toBe("/coins/markets");
        expect(url.searchParams.get("vs_currency")).toBe("usd");
        expect(url.searchParams.get("per_page")).toBe("250");
        return url.searchParams.get("ids")!.split(",").map(id => ({ id, current_price: 2 }));
      } },
      redis: { set: async (key, value) => { writes.push({ key: String(key), value: String(value) }); return "OK"; } },
      now: () => 12345,
    });
    expect(paths.map(path => new URL(path, "https://api.coingecko.com").searchParams.get("ids")!.split(",").length)).toEqual([250, 1]);
    expect(Object.keys(snapshot.assets)).toHaveLength(252);
    expect(snapshot.assets["nep141:wrap.near"]).toEqual({ ...empty, price: 2 });
    expect(snapshot.assets["asset-0-bridged"]).toBe(snapshot.assets["asset-0"]);
    expect(writes).toEqual([{ key: TOKEN_MARKETS_KEY, value: JSON.stringify(snapshot) }]);
    expect(snapshot.updatedAt).toBe(12345);
  });

  test("failed or malformed later batches preserve the previous value", async () => {
    for (const failure of ["http", "envelope", "row"]) {
      let stored = "previous snapshot";
      let calls = 0;
      await expect(refreshTokenMarkets({
        catalog: { get: async () => Array.from({ length: 251 }, (_, i) => ({ assetId: `asset-${i}`, coingeckoId: `coin-${i}` })) },
        markets: { get: async () => {
          if (++calls === 1) return [{ id: "coin-0", current_price: 1 }];
          if (failure === "http") throw new Error("CoinGecko 429");
          return failure === "envelope" ? { error: "invalid key" } : [null];
        } },
        redis: { set: async (_key, value) => { stored = String(value); return "OK"; } },
      })).rejects.toThrow();
      expect(calls).toBe(2);
      expect(stored).toBe("previous snapshot");
    }
  });

  test("endpoint serves stored JSON without rewriting it and returns 503 when absent", async () => {
    const body = JSON.stringify({ updatedAt: 12345, assets: { "nep141:wrap.near": empty } });
    const request = new Request("https://data.example/v1/token-markets", { headers: { "cf-ray": "test-ray" } });
    const response = await tokenMarketsResponse({ get: async key => { expect(key).toBe(TOKEN_MARKETS_KEY); return body; } }, request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await response.text()).toBe(body);
    const unavailable = await tokenMarketsResponse({ get: async () => null }, request);
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
    expect(await unavailable.json()).toEqual({ error: "Token market data temporarily unavailable", requestId: "test-ray", revision: process.env.DATA_REVISION?.trim() || "1" });
  });
});

test("reviewed CoinGecko overrides win without changing asset IDs, including NEAR", async () => {
  expect(tokenMarketIds([{ assetId: "asset", coingeckoId: "wrong", coingeckoIdOverride: "correct" }, {assetId:"nep141:wrap.near",coingeckoId:"wrapped-near",coingeckoIdOverride:"reviewed-near"}])).toEqual({asset:"correct","nep141:wrap.near":"reviewed-near"});
  const requests: string[]=[];
  const snapshot=await refreshTokenMarkets({catalog:{get:async()=>[{assetId:"asset",coingeckoId:"wrong",coingeckoIdOverride:"correct"}]},markets:{get:async(path:string)=>{requests.push(path);return [{id:"correct",current_price:42}];}},redis:{set:async()=>"OK"},now:()=>1});
  expect(requests[0]).toContain("ids=correct");expect(snapshot.assets.asset!.price).toBe(42);
});
