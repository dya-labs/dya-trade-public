import { afterEach, expect, test } from "bun:test";
import { Admission, admittedAssets, admitPrices, CatalogUnavailable } from "../src/registry";
import type { RegistryAsset } from "../src/registry-types";

const asset: RegistryAsset = { assetId: "nep141:btc.omft.near", symbol: "BTC", chain: "btc", contract: null, coinGeckoId: "bitcoin", aliases: [], unavailableReason: null, sources: [{ id: "binance:BTCUSDT", venue: "binance", symbol: "BTCUSDT", base: "BTC", quote: "USDT", rank: 2, validFrom: Date.parse("2017-08-17T04:00:00Z"), validTo: null, coinGeckoTickerUrl: "https://api.coingecko.com/api/v3/coins/bitcoin/tickers?exchange_ids=binance", continuationOf: null, conversionRatio: "1" }] };
const now = Date.parse("2026-10-12T12:00:00Z");
const token = { assetId: asset.assetId, symbol: "BTC", price: 100, priceUpdatedAt: new Date(now).toISOString() };
const price = (value: number, id = "binance:BTCUSDT") => new Map([[id, value]]);

test("registry never admits a same-symbol catalog impostor", () => {
  expect(admitPrices([asset], [{ ...token, assetId: "nep141:impostor.near" }], price(100), now)[0]!.sources).toHaveLength(0);
});

test("runtime price admission fails closed on stale, missing or divergent prices", () => {
  expect(admitPrices([asset], [token], price(114), now)[0]!.sources).toHaveLength(1);
  expect(admitPrices([asset], [token], price(116), now)[0]!.sources).toHaveLength(0);
  expect(admitPrices([asset], [token], new Map(), now)[0]!.sources).toHaveLength(0);
  expect(admitPrices([asset], [token], price(100), now + 15 * 60_000)[0]!.sources).toHaveLength(0);
  expect(admitPrices([asset], [{ ...token, price: 0 }], price(100), now)[0]!.sources).toHaveLength(0);
});

test("a venue price only admits its own market, not the same symbol on another venue", () => {
  expect(admitPrices([asset], [token], price(100, "mexc:BTCUSDT"), now)[0]!.sources).toHaveLength(0);
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("an unreachable or malformed 1Click catalog is CatalogUnavailable, distinct from a failed price check", async () => {
  globalThis.fetch = (async () => new Response("error code: 521", { status: 521 })) as unknown as typeof fetch;
  await expect(admittedAssets([asset], price(100))).rejects.toBeInstanceOf(CatalogUnavailable);
  globalThis.fetch = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await expect(admittedAssets([asset], price(100))).rejects.toBeInstanceOf(CatalogUnavailable);
  globalThis.fetch = (async () => Response.json({ error: "maintenance" })) as unknown as typeof fetch;
  await expect(admittedAssets([asset], price(100))).rejects.toBeInstanceOf(CatalogUnavailable);
});

const retired = { ...asset.sources[0]!, id: "binance:BTCUSD", symbol: "BTCUSD", validTo: Date.parse("2020-01-01T00:00:00Z") };
const successor = { ...asset.sources[0]!, id: "binance:BTCUSDC", symbol: "BTCUSDC", quote: "USDC", continuationOf: "binance:BTCUSD" };
const unrelatedRetired = { ...retired, id: "okx:BTC-USDT", venue: "okx" };
const registry: RegistryAsset[] = [{ ...asset, sources: [...asset.sources, retired, successor, unrelatedRetired] }];
const ids = (assets: RegistryAsset[]) => assets.flatMap(item => item.sources.map(source => source.id)).sort();
const down = async (): Promise<RegistryAsset[]> => { throw new CatalogUnavailable("1Click token catalog unavailable (HTTP 521)"); };

test("a 1Click outage keeps the last admitted markets listed and reports degradation until it recovers", async () => {
  let outcome: () => Promise<RegistryAsset[]> = async () => [{ ...asset }];
  let clock = now;
  const admission = new Admission(() => outcome(), () => clock);
  expect(ids(await admission.run(registry, price(100)))).toEqual(["binance:BTCUSDT"]);
  expect(admission.degraded).toBeNull();

  outcome = down;
  expect(ids(await admission.run(registry, price(100)))).toEqual(["binance:BTCUSDT"]);
  expect(admission.degraded).toEqual({ cause: "near-intents", since: now });
  clock = now + 60_000;
  await admission.run(registry, price(100));
  expect(admission.degraded?.since).toBe(now);

  outcome = async () => [{ ...asset, sources: [] }];
  expect(ids(await admission.run(registry, price(100)))).toEqual([]);
  expect(admission.degraded).toBeNull();
});

test("starting during a 1Click outage lists current registry sources and their continuation predecessors", async () => {
  const admission = new Admission(down, () => now);
  expect(ids(await admission.run(registry, price(100)))).toEqual(["binance:BTCUSD", "binance:BTCUSDC", "binance:BTCUSDT"]);
  expect(admission.degraded).toEqual({ cause: "near-intents", since: now });
});

test("failures other than the 1Click catalog propagate without reporting a NEAR degradation", async () => {
  const admission = new Admission(async () => { throw new Error("ClickHouse unavailable"); });
  await expect(admission.run(registry, price(100))).rejects.toThrow("ClickHouse unavailable");
  expect(admission.degraded).toBeNull();
});
