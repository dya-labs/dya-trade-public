import { RedisClient } from "bun";
import { marketCloses } from "../../candles/closes";
import { DAY, MINUTE, type Kline } from "../../candles/kline";
import { TradeBar } from "../../ingest/minutes";
import { prop } from "../../json";
import { liveKeys } from "../../live/protocol";
import { publishRollingTickers } from "../../live/rolling";
import { log } from "../../log";
import { valkeyNearBlocks } from "../../near/feed";
import { NearLogIndexer } from "../../near/indexer";
import { readRegistrySeed } from "../../registry";
import type { OnchainPair } from "../../registry-types";
import type { LiveSink, Venue, VenueContext, VenueRest } from "../types";
import { loadRheaState, rheaSource } from "./indexer";
import { NEAR_MARKET, quoteRate, swapTrade } from "./price";
import type { Swap } from "./swaps";

const FIELDS = { quoteVolume: true, trades: true, takerBuy: true };
const TICKER_MS = 10_000;
// The live USD rate uses the newest NEARUSDC minute in Valkey; older than this, trades wait for the settled candle.
const NEAR_STALE_MS = 3 * MINUTE;

const floorMinute = (time: number) => Math.floor(time / MINUTE) * MINUTE;

/** The reviewed Rhea pairs of the registry, by symbol. */
export async function rheaPairs(): Promise<Map<string, OnchainPair>> {
  const seed = await readRegistrySeed();
  return new Map(seed.assets.flatMap(asset => asset.sources.filter(source => source.venue === "rhea" && source.onchain).map(source => [source.symbol, source.onchain!] as const)));
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

type RestDeps = { pairs?: () => Promise<Map<string, OnchainPair>> };

/**
 * Candles in USD from the indexer's switch minute on: every stored swap of the pair, across all
 * Rhea pools, priced in the quote token and converted with that minute's NEARUSDC close.
 */
export function createRheaRest(context: VenueContext, deps: RestDeps = {}): VenueRest {
  const { clickhouse } = context;
  let pairs: Promise<Map<string, OnchainPair>> | undefined;
  const pairOf = async (symbol: string) => {
    pairs ??= (deps.pairs ?? rheaPairs)();
    const pair = (await pairs).get(symbol);
    if (!pair) throw new Error(`Unknown Rhea pair: ${symbol}`);
    return pair;
  };

  async function swaps(pair: OnchainPair, from: number, to: number, closes: Map<number, string>): Promise<Kline[]> {
    const rows = await clickhouse.query<{ height: number; time: number; receipt: string; index: number; tokenIn: string; tokenOut: string; amountIn: string; amountOut: string }>(
      `SELECT block_height AS height, toUnixTimestamp64Milli(block_time) AS time, receipt_id AS receipt, log_index AS index,
         token_in AS tokenIn, token_out AS tokenOut, toString(amount_in) AS amountIn, toString(amount_out) AS amountOut
       FROM rhea_swaps FINAL
       WHERE ((token_in = {base:String} AND token_out = {quote:String}) OR (token_in = {quote:String} AND token_out = {base:String}))
         AND block_time >= fromUnixTimestamp64Milli({from:Int64}, 'UTC') AND block_time < fromUnixTimestamp64Milli({to:Int64}, 'UTC')
       ORDER BY block_time, block_height, receipt_id, log_index`,
      { base: pair.base, quote: pair.quote, from, to });
    const bars = new Map<number, TradeBar>();
    for (const row of rows) {
      const time = Number(row.time);
      const rate = quoteRate(pair, closes.get(floorMinute(time)));
      if (rate === undefined) throw new Error(`No NEARUSDC close for ${new Date(time).toISOString()}`);
      const swap: Swap = { height: Number(row.height), time, txHash: "", receiptId: row.receipt, logIndex: Number(row.index), contract: "classic", poolId: "", tokenIn: row.tokenIn, tokenOut: row.tokenOut, amountIn: BigInt(row.amountIn), amountOut: BigInt(row.amountOut) };
      const trade = swapTrade(swap, pair, rate);
      if (!trade) continue;
      const bar = bars.get(floorMinute(time));
      if (bar) bar.add(trade); else bars.set(floorMinute(time), new TradeBar(trade, FIELDS));
    }
    return [...bars.values()].map(bar => bar.snapshot());
  }

  return {
    // The registry's base (the asset symbol, e.g. mpDAO) and quote (USD) label the market.
    async instruments() {
      const seed = await readRegistrySeed();
      return seed.assets.flatMap(asset => asset.sources.filter(source => source.venue === "rhea" && source.onchain))
        .map(source => ({ symbol: source.symbol, base: source.base, quote: source.quote, status: "TRADING" }));
    },
    async candles(symbol, resolution, from, to) {
      if (resolution !== "1m") throw new Error("Rhea stores 1m candles only");
      const pair = await pairOf(symbol);
      const { cursor, switchAt } = await loadRheaState(clickhouse);
      if (cursor === null || switchAt === null) return { klines: [], coveredTo: from };
      if (from < switchAt) return { klines: [], coveredTo: Math.min(to, switchAt) };
      let end = Math.min(to, from + DAY, floorMinute(cursor.time));
      const { closes, syncedTo } = await marketCloses(clickhouse, NEAR_MARKET, from, Math.max(from, end));
      if (quoteRate(pair, undefined) === undefined) end = Math.min(end, floorMinute(syncedTo));
      if (end <= from) return { klines: [], coveredTo: from };
      return { klines: await swaps(pair, from, end, closes), coveredTo: end };
    },
    async earliest(symbol) {
      await pairOf(symbol);
      return (await loadRheaState(clickhouse)).switchAt;
    },
    async nativeCandles() {
      throw new Error("Rhea has no native candles; its candles are built from indexed swaps");
    },
  };
}

function openRheaStream(context: VenueContext, symbols: readonly string[], sink: LiveSink): { close(): void } {
  const redis = new RedisClient(context.redisUrl);
  const bySymbol = new Map<string, OnchainPair>();
  const byKey = new Map<string, { symbol: string; pair: OnchainPair }>();
  let near: { openTime: number; close: string } | undefined;
  let stopped = false;
  const timers: Timer[] = [];

  const refreshNear = async () => {
    const recent = await redis.hgetall(liveKeys(NEAR_MARKET.venue).recent(NEAR_MARKET.symbol));
    const latest = Object.keys(recent).map(Number).filter(Number.isFinite).sort((a, b) => b - a)[0];
    if (latest !== undefined) near = { openTime: latest, close: String(prop(JSON.parse(recent[String(latest)]!), "close")) };
  };

  const trade = (swaps: Swap[]) => {
    const fresh = near && Date.now() - near.openTime <= NEAR_STALE_MS ? near.close : undefined;
    for (const swap of swaps) {
      const match = byKey.get(pairKey(swap.tokenIn, swap.tokenOut));
      if (!match) continue;
      const rate = quoteRate(match.pair, fresh);
      if (rate === undefined) continue;
      const result = swapTrade(swap, match.pair, rate);
      if (result) sink.trade(match.symbol, result);
    }
  };

  const tickers = () => publishRollingTickers(context.clickhouse, redis, "rhea", [...bySymbol.keys()], sink);

  const loop = (name: string, task: () => Promise<void>, every: number) => {
    const run = () => { if (!stopped) task().catch(error => log(`rhea.${name}.failed`, { error: String(error) }, "error")); };
    run();
    timers.push(setInterval(run, every));
  };

  const blocks = valkeyNearBlocks(context.redisUrl);
  const indexer = new NearLogIndexer(rheaSource, { clickhouse: context.clickhouse, blocks, neardata: context.neardata },
    { rows: trade, connected: sink.connected, invalid: sink.invalid });
  void (async () => {
    const pairs = await rheaPairs();
    for (const symbol of symbols) {
      const pair = pairs.get(symbol);
      if (!pair) { sink.invalid(`Unknown Rhea pair: ${symbol}`); continue; }
      bySymbol.set(symbol, pair);
      byKey.set(pairKey(pair.base, pair.quote), { symbol, pair });
    }
    await redis.connect();
    loop("near", refreshNear, 1000);
    loop("tickers", tickers, TICKER_MS);
    if (!stopped) await indexer.start();
  })().catch(error => sink.invalid(`Rhea stream failed to start: ${String(error)}`));

  return {
    close() {
      stopped = true;
      for (const timer of timers) clearInterval(timer);
      void indexer.close().finally(() => { blocks.close(); redis.close(); });
      sink.connected(false);
    },
  };
}

export const rhea: Venue = {
  id: "rhea", label: "Rhea",
  // Rhea pairs come from the reviewed on-chain registry sources, never from CoinGecko exchange tickers.
  coinGeckoId: "",
  history: ["1m"], fields: FIELDS,
  parityIntervals: [],
  // Candles and live swaps both come from the NEAR block feed; there is no venue REST API.
  defaults: { restUrl: "", streamUrl: "", budget: 1 },
  symbol: (base, quote) => `${base}_${quote}`.toUpperCase(),
  rest: (_options, context) => createRheaRest(context),
  live: (_options, _rest, context) => ({ open: (symbols, sink) => openRheaStream(context, symbols, sink) }),
};
