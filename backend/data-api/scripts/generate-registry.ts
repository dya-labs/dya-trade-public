import { ClickHouse } from "../src/clickhouse";
import { loadConfig } from "../src/config";
import { prop } from "../src/json";
import type { RegistryAsset, RegistrySeed, RegistrySource } from "../src/registry-types";
import { VENUES } from "../src/venues";
import { loadRheaState } from "../src/venues/rhea/indexer";
import type { Instrument, Venue, VenueRest } from "../src/venues/types";
import { DAY, MINUTE } from "../src/candles/kline";
import { EXPLORER_URL } from "../src/venues/intents/explorer";
import { buildCatalog } from "../src/venues/intents/catalog";
import { addContinuations } from "./registry-continuations";

/**
 * Reviewed market discovery. A pair is a source only when CoinGecko lists it for the asset's own
 * coin id (never by symbol), the venue lists it as trading, and its price is within 15% of the
 * 1Click catalog price. Binance pairs come first; assets without one get the pairs of a single
 * other venue: the most liquid venue that serves full 1m history, else the most liquid other one.
 * NEAR tokens with no exchange pair fall back to their Rhea pair against wNEAR from our own swap
 * index (`rheaSource`).
 * Assets with an exchange market that 1Click users swapped lately also get a NEAR Intents market,
 * never primary (`addIntentsSources`); reviewed stablecoins are recorded for its USD pricing.
 * Usage: `bun scripts/generate-registry.ts [SYMBOL...]` (symbols: regenerate only those assets), or
 * `--intents [SYMBOL...]` to refresh only the stablecoins and the Intents sources of the current
 * seed (of those assets only, when given).
 */
const catalogUrl = "https://1click.chaindefuser.com/v0/tokens";
const exchangeInfoUrl = "https://data-api.binance.vision/api/v3/exchangeInfo";
const aliases: Record<string, string> = {
  "avalanche-2": "avalanche", binancecoin: "bnb", "wrapped-near": "near",
  ripple: "xrp", "polygon-ecosystem-token": "polygon", "matic-network": "polygon",
  "berachain-bera": "berachain", dogwifcoin: "dogwifhat", "the-open-network": "gram",
  // 1Click's `custom:` ids are not CoinGecko routes; these are the coins' API ids.
  "custom:prl": "pearl-2",
};
const QUOTE_RANK: Record<string, number> = { USDC: 1, USDT: 2, USD: 3 };
const identities = await Bun.file(new URL("../../../packages/wallet-contracts/src/domain/canonical-assets.ts", import.meta.url)).text();
const listings: unknown[] = identities.split("\n").filter(line => line.trim().startsWith('{"symbol":')).map(line => JSON.parse(line.trim().replace(/,$/, "")));
const selected = listings.filter(row => prop(row, "selectorHidden") !== true);

async function json(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

/**
 * Public keyless CoinGecko: serialized calls with server-directed cooldowns. Under load it also
 * answers 200 with an empty ticker list for coins that do have tickers, so empty lists are retried.
 */
async function coinGecko(url: string): Promise<unknown[]> {
  for (let attempt = 0; ; attempt++) {
    await Bun.sleep(attempt ? 60_000 : 15_000);
    let response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    while (response.status === 429) {
      const retry = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      await Bun.sleep(Math.max(60, Number.isFinite(retry) ? retry : 60) * 1000);
      response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    }
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const tickers = prop(await response.json(), "tickers");
    if (!Array.isArray(tickers)) throw new Error(`Invalid CoinGecko tickers: ${url}`);
    if (tickers.length || attempt === 2) return tickers;
  }
}

const rests = new Map<string, VenueRest>();
const instrumentCache = new Map<string, Instrument[]>();
const config = loadConfig();
const context = { clickhouse: new ClickHouse(config.clickhouse), redisUrl: config.redisUrl, intentsExplorerJwt: config.intentsExplorerJwt, neardata: config.neardata };
async function instruments(venue: Venue): Promise<Instrument[]> {
  if (!instrumentCache.has(venue.id)) {
    rests.set(venue.id, venue.rest(venue.defaults, context));
    instrumentCache.set(venue.id, await rests.get(venue.id)!.instruments());
  }
  return instrumentCache.get(venue.id)!;
}

type Candidate = { venue: Venue; base: string; quote: string; volume: number };

async function sourceFor(candidate: Candidate, url: string): Promise<RegistrySource | undefined> {
  const { venue, base, quote } = candidate;
  const pair = (await instruments(venue)).find(row => row.base === base && row.quote === quote && row.status === "TRADING");
  if (!pair) return undefined;
  // The coarsest stored tier reaches furthest back.
  const validFrom = await rests.get(venue.id)!.earliest(pair.symbol, venue.history.at(-1)!);
  if (validFrom === null) throw new Error(`Missing first candle: ${venue.id}:${pair.symbol}`);
  return { id: `${venue.id}:${pair.symbol}`, venue: venue.id, symbol: pair.symbol, base, quote, rank: QUOTE_RANK[quote]!, validFrom, validTo: null, coinGeckoTickerUrl: url, continuationOf: null, conversionRatio: "1" };
}

const RHEA_QUOTE = "wrap.near";
// Swaps this recent decide whether a Rhea pair is active, and the latest one checks its price.
const RHEA_ACTIVITY_MS = 3 * DAY;

/**
 * NEAR tokens without an exchange market: their Rhea pair against wNEAR from our swap index
 * (`rhea_swaps`), starting at the indexer's switch minute. The pair needs a swap in the last
 * RHEA_ACTIVITY_MS whose price, at the catalog's wNEAR price, is within 15% of the 1Click catalog
 * price, as for exchange pairs. Decimals come from the 1Click catalog.
 */
async function rheaSource(asset: RegistryAsset, token: unknown, tokens: readonly unknown[], catalogPrice: number): Promise<RegistrySource | undefined> {
  if (asset.chain !== "near" || !asset.contract) return undefined;
  const { switchAt } = await loadRheaState(context.clickhouse);
  if (switchAt === null) return undefined;
  const near = tokens.find(row => prop(row, "assetId") === `nep141:${RHEA_QUOTE}`);
  const baseDecimals = prop(token, "decimals"), quoteDecimals = prop(near, "decimals"), nearPrice = Number(prop(near, "price"));
  if (typeof baseDecimals !== "number" || typeof quoteDecimals !== "number" || !(nearPrice > 0)) return undefined;
  const [latest] = await context.clickhouse.query<{ tokenIn: string; amountIn: string; amountOut: string }>(
    `SELECT token_in AS tokenIn, toString(amount_in) AS amountIn, toString(amount_out) AS amountOut FROM rhea_swaps FINAL
     WHERE ((token_in = {base:String} AND token_out = {quote:String}) OR (token_in = {quote:String} AND token_out = {base:String}))
       AND block_time >= fromUnixTimestamp64Milli({from:Int64}, 'UTC')
     ORDER BY block_time DESC LIMIT 1`,
    { base: asset.contract, quote: RHEA_QUOTE, from: Date.now() - RHEA_ACTIVITY_MS });
  if (!latest) return undefined;
  const [baseAmount, quoteAmount] = latest.tokenIn === asset.contract ? [latest.amountIn, latest.amountOut] : [latest.amountOut, latest.amountIn];
  const price = Number(quoteAmount) / 10 ** quoteDecimals / (Number(baseAmount) / 10 ** baseDecimals) * nearPrice;
  if (!(catalogPrice > 0 && price > 0 && Math.abs(price / catalogPrice - 1) <= 0.15)) return undefined;
  const symbol = VENUES.rhea!.symbol(asset.symbol, "WNEAR");
  return {
    id: `rhea:${symbol}`, venue: "rhea", symbol, base: asset.symbol, quote: "USD", rank: 1,
    validFrom: switchAt, validTo: null,
    coinGeckoTickerUrl: "https://app.rhea.finance", continuationOf: null, conversionRatio: "1",
    onchain: { base: asset.contract, quote: RHEA_QUOTE, baseDecimals, quoteDecimals },
  };
}

// Swaps this recent decide which assets get an Intents market (about 16,600 a day: 3 days ≈ 50 Explorer pages).
const INTENTS_ACTIVITY_MS = 3 * DAY;

/**
 * Replaces the Intents sources of `only` (every asset when empty): an asset that already has a
 * market and that 1Click users swapped in the last INTENTS_ACTIVITY_MS (per the Intents Explorer)
 * gets `intents:<SYMBOL>_USD` at rank 100, so it is never primary. Stablecoins get none; they are
 * the USD quote.
 */
async function addIntentsSources(tokens: readonly unknown[], assets: RegistryAsset[], stablecoins: string[], only: readonly string[]): Promise<void> {
  if (!config.intentsExplorerJwt) { console.log("Intents: INTENTS_EXPLORER_JWT unset, Intents sources unchanged"); return; }
  const targets = assets.filter(asset => !only.length || only.includes(asset.symbol));
  for (const asset of targets) asset.sources = asset.sources.filter(source => source.venue !== "intents");
  const resolved = buildCatalog(tokens, { generatedAt: "", catalogUrl, exchangeInfoUrl, assets, stablecoins });
  const traded = new Set<string>();
  const since = Date.now() - INTENTS_ACTIVITY_MS;
  for (let before = Date.now(); before > since;) {
    await Bun.sleep(5_500);
    const url = new URL(EXPLORER_URL);
    url.search = new URLSearchParams({ numberOfTransactions: "1000", statuses: "SUCCESS", endTimestamp: new Date(before).toISOString() }).toString();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${config.intentsExplorerJwt}` }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Intents Explorer: HTTP ${response.status}`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error("Invalid Intents Explorer page");
    for (const row of rows) for (const field of ["originAsset", "destinationAsset"]) {
      const group = resolved.resolve(String(prop(row, field)))?.group;
      if (group) traded.add(group);
    }
    if (rows.length < 1000) break;
    before = Math.min(...rows.map(row => Date.parse(String(prop(row, "createdAt")))));
  }
  const stable = new Set(stablecoins);
  for (const asset of targets) {
    if (!asset.sources.length || !asset.coinGeckoId || stable.has(asset.assetId) || !traded.has(asset.coinGeckoId)) continue;
    const symbol = VENUES.intents!.symbol(asset.symbol, "USD");
    asset.sources.push({
      id: `intents:${symbol}`, venue: "intents", symbol, base: asset.symbol, quote: "USD", rank: 100,
      validFrom: Math.ceil((Date.now() - 179 * DAY) / MINUTE) * MINUTE, validTo: null,
      coinGeckoTickerUrl: "https://explorer.near-intents.org", continuationOf: null, conversionRatio: "1",
    });
  }
  console.log(`Intents: ${assets.filter(asset => asset.sources.some(source => source.venue === "intents")).length} markets from ${traded.size} traded assets`);
}

const catalog = await json(catalogUrl);
const exchange = prop(await json(exchangeInfoUrl), "symbols");
if (!Array.isArray(catalog) || !Array.isArray(exchange)) throw new Error("Invalid upstream catalogs");
// The wallet's reviewed stablecoin identities (`isSupportedStablecoin`), read like the canonical
// listings above: CoinGecko id → accepted symbols.
const stablecoinSource = await Bun.file(new URL("../../../packages/wallet-contracts/src/domain/stablecoins.ts", import.meta.url)).text();
const stableIdentities = new Map([...stablecoinSource.slice(stablecoinSource.indexOf("identities"), stablecoinSource.indexOf("};")).matchAll(/["']?([a-z0-9-]+)["']?:\s*\[([^\]]*)\]/g)]
  .map(match => [match[1]!, [...match[2]!.matchAll(/"([^"]+)"/g)].map(symbol => symbol[1]!)] as const));
if (stableIdentities.size < 10) throw new Error("Stablecoin identities not found in wallet-contracts");
const stablecoins = catalog.filter(token => stableIdentities.get(String(prop(token, "coingeckoId")))?.includes(String(prop(token, "symbol")))).map(token => String(prop(token, "assetId")));
const seedUrl = new URL("../registry/seed.json", import.meta.url);
if (process.argv[2] === "--intents") {
  const current: RegistrySeed = await Bun.file(seedUrl).json();
  await addIntentsSources(catalog, current.assets, stablecoins, process.argv.slice(3));
  await Bun.write(seedUrl, JSON.stringify({ ...current, stablecoins }, null, 2) + "\n");
  process.exit(0);
}
const only = process.argv.slice(2);
const previous: RegistrySeed | undefined = only.length ? await Bun.file(seedUrl).json() : undefined;
const assets: RegistryAsset[] = previous ? previous.assets.filter(asset => !only.includes(asset.symbol)) : [];
for (const listing of selected.filter(row => !only.length || only.includes(String(prop(row, "symbol"))))) {
  const assetId = String(prop(listing, "assetId"));
  const token = catalog.find(row => prop(row, "assetId") === assetId);
  if (!token) throw new Error(`Canonical listing missing from live catalog: ${assetId}`);
  const originalId = prop(token, "coingeckoId");
  const cg = assetId === "nep141:wrap.near" ? "near" : typeof originalId === "string" ? aliases[originalId] ?? originalId : null;
  const asset: RegistryAsset = { assetId, symbol: String(prop(token, "symbol")), chain: String(prop(token, "blockchain")), contract: typeof prop(token, "contractAddress") === "string" ? String(prop(token, "contractAddress")) : null, coinGeckoId: cg, aliases: typeof originalId === "string" && cg !== originalId ? [originalId] : [], sources: [], unavailableReason: null };
  if (!cg) asset.unavailableReason = "No CoinGecko identity in 1Click catalog";
  else {
    // CoinGecko's ticker IDs can differ from its URL routes; retain the catalog route as an alias.
    const routeId = assetId === "nep141:wrap.near" ? "near" : String(originalId).startsWith("custom:") ? cg : String(originalId);
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(routeId)}/tickers?order=volume_desc&depth=false`;
    const catalogPrice = Number(prop(token, "price"));
    const listed = await coinGecko(url);
    // The route resolves to one coin; its tickers carry that coin's current id (based-brett → brett-2).
    const canonical = listed.map(ticker => prop(ticker, "coin_id")).find(id => typeof id === "string") ?? cg;
    if (typeof canonical === "string" && canonical !== cg) {
      asset.aliases = [...new Set([...asset.aliases, cg])];
      asset.coinGeckoId = canonical;
    }
    const tickers = listed.filter(ticker => {
      const venuePrice = Number(prop(prop(ticker, "converted_last"), "usd"));
      return prop(ticker, "coin_id") === canonical && prop(ticker, "is_stale") !== true && prop(ticker, "is_anomaly") !== true
        && typeof prop(ticker, "base") === "string" && typeof prop(ticker, "target") === "string" && Object.hasOwn(QUOTE_RANK, String(prop(ticker, "target")))
        && catalogPrice > 0 && venuePrice > 0 && Math.abs(venuePrice / catalogPrice - 1) <= 0.15;
    });
    for (const ticker of tickers.filter(ticker => prop(prop(ticker, "market"), "identifier") === "binance" && prop(ticker, "target") !== "USD")) {
      const base = String(prop(ticker, "base")), quote = String(prop(ticker, "target"));
      const pair = exchange.find(row => prop(row, "baseAsset") === base && prop(row, "quoteAsset") === quote && prop(row, "status") === "TRADING" && prop(row, "isSpotTradingAllowed") !== false);
      if (!pair) continue;
      const source = await sourceFor({ venue: VENUES.binance!, base, quote, volume: 0 }, url);
      if (!source) continue;
      if (base === "POL") source.continuationOf = `binance:MATIC${quote}`;
      if (base === "GRAM") source.continuationOf = `binance:TON${quote}`;
      asset.sources.push(source);
    }
    if (!asset.sources.length) {
      const candidates: Candidate[] = tickers.flatMap(ticker => {
        const venue = Object.values(VENUES).find(row => row.id !== "binance" && row.coinGeckoId === prop(prop(ticker, "market"), "identifier"));
        return venue ? [{ venue, base: String(prop(ticker, "base")), quote: String(prop(ticker, "target")), volume: Number(prop(prop(ticker, "converted_volume"), "usd")) || 0 }] : [];
      });
      // Full 1m history wins unless a short-retention venue trades at least 5x more: a thin market
      // charts worse than a liquid one whose minutes only reach back a week or a month.
      const venueVolume = (id: string) => candidates.filter(candidate => candidate.venue.id === id).reduce((sum, candidate) => sum + candidate.volume, 0);
      const best = (deep: boolean) => Math.max(0, ...candidates.filter(candidate => (candidate.venue.history.length === 1) === deep).map(candidate => venueVolume(candidate.venue.id)));
      const preferShallow = best(false) >= 5 * best(true);
      const order = (candidate: Candidate) => ((candidate.venue.history.length === 1) === preferShallow ? 1 : 0);
      candidates.sort((a, b) => order(a) - order(b) || venueVolume(b.venue.id) - venueVolume(a.venue.id));
      for (const venueId of [...new Set(candidates.map(candidate => candidate.venue.id))]) {
        // Within the chosen venue the most liquid pair is primary (OKB-USDT trades ~70x OKB-USDC).
        const pairs = candidates.filter(row => row.venue.id === venueId).sort((a, b) => b.volume - a.volume);
        for (const candidate of pairs) {
          const source = await sourceFor(candidate, url);
          if (source && !asset.sources.some(existing => existing.id === source.id)) asset.sources.push({ ...source, rank: asset.sources.length + 1 });
        }
        if (asset.sources.length) break;
      }
    }
    if (!asset.sources.length) {
      const source = await rheaSource(asset, token, catalog, catalogPrice);
      if (source) asset.sources.push(source);
    }
    asset.sources.sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol));
    if (!asset.sources.length) asset.unavailableReason = "No supported exchange pair admitted by CoinGecko identity, venue listing and catalog price sanity";
  }
  assets.push(asset);
  console.log(`${asset.symbol}: ${asset.sources.map(source => source.id).join(",") || asset.unavailableReason}`);
}
await addContinuations(assets);
await addIntentsSources(catalog, assets, stablecoins, only);
const seed: RegistrySeed = { generatedAt: new Date().toISOString(), catalogUrl, exchangeInfoUrl, assets, stablecoins };
await Bun.write(seedUrl, JSON.stringify(seed, null, 2) + "\n");
console.log(`Registry: ${assets.length} assets, ${assets.filter(asset => asset.sources.length).length} covered`);
