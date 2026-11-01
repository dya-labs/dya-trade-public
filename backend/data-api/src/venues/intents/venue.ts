import { RedisClient } from "bun";
import { units } from "../../candles/bar";
import { DAY, MINUTE } from "../../candles/kline";
import type { ClickHouse } from "../../clickhouse";
import { TradeBar } from "../../ingest/minutes";
import { prop } from "../../json";
import { liveKeys } from "../../live/protocol";
import { publishRollingTickers } from "../../live/rolling";
import { log } from "../../log";
import { valkeyNearBlocks } from "../../near/feed";
import { NearLogIndexer } from "../../near/indexer";
import { readRegistrySeed } from "../../registry";
import type { LiveSink, Venue, VenueContext, VenueRest } from "../types";
import { IntentsBackfill } from "./backfill";
import { IntentsSources } from "./explorer";
import { buildCatalog, CATALOG_URL, USD, type IntentsCatalog } from "./catalog";
import type { IntentDiff } from "./diffs";
import { diffFromRow, DIFF_COLUMNS, type DiffRow } from "./rows";
import { intentsSource, loadIntentsState } from "./indexer";
import { historicalRates, marketTrade } from "./pricing";
import { updateCoverage } from "./coverage";
import { IntentsSettlements, storedSettlements, type StoredSettlement } from "./settlements";
import { receiptTrades, settlementTrades, type RouteTrade } from "./trades";

const FIELDS = { quoteVolume: true, trades: true, takerBuy: true };
/** History reaches this far back from the switch minute (180 days, a day inside it). */
export const HISTORY_MS = 179 * DAY;
// An Explorer swap executes up to 30 minutes after its creation time, so
// executions are complete only this far after the backfill position.
export const BACKFILL_MARGIN_MS = 2 * 60 * MINUTE;
const CATALOG_REFRESH_MS = 60 * MINUTE;
// Until the stream's first 1Click catalog load succeeds (1Click down at start), it retries this often.
const CATALOG_RETRY_MS = 30_000;
const TICKER_MS = 10_000;
// Coverage computes up to a day of closed hours per pass; a catch-up after the backfill takes a few hours.
const COVERAGE_MS = 5 * MINUTE;
// Live trades use each quote asset's newest exchange minute in Valkey; older than this, they wait for the settled candle.
const QUOTE_STALE_MS = 3 * MINUTE;
// A receipt's token_diff logs arrive together; one is complete once a later block arrived or this long passed.
const RECEIPT_WAIT_MS = 3_000;

const floorMinute = (time: number) => Math.floor(time / MINUTE) * MINUTE;

/** The 1Click catalog resolved against the registry, refreshed hourly; a failed refresh keeps the last one. */
export function catalogLoader(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  let current: { catalog: IntentsCatalog; at: number } | undefined;
  return async (): Promise<IntentsCatalog> => {
    if (current && now() - current.at < CATALOG_REFRESH_MS) return current.catalog;
    try {
      const response = await fetcher(CATALOG_URL, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`1Click catalog HTTP ${response.status}`);
      const tokens: unknown = await response.json();
      if (!Array.isArray(tokens)) throw new Error("Invalid 1Click catalog");
      current = { catalog: buildCatalog(tokens, await readRegistrySeed()), at: now() };
    } catch (error) {
      if (!current) throw error;
      log("intents.catalog.stale", { error: String(error) }, "warn");
    }
    return current.catalog;
  };
}

/** Every stored intent of the receipts in [from, to) that touch any of `assetIds`, in receipt order. */
async function receiptsTouching(clickhouse: ClickHouse, assetIds: readonly string[], from: number, to: number): Promise<IntentDiff[][]> {
  const rows = await clickhouse.query<DiffRow>(
    `SELECT ${DIFF_COLUMNS} FROM intents_diffs FINAL
     WHERE block_time >= fromUnixTimestamp64Milli({from:Int64}, 'UTC') AND block_time < fromUnixTimestamp64Milli({to:Int64}, 'UTC')
       AND receipt_id IN (
         SELECT receipt_id FROM intents_diffs
         WHERE block_time >= fromUnixTimestamp64Milli({from:Int64}, 'UTC') AND block_time < fromUnixTimestamp64Milli({to:Int64}, 'UTC')
           AND hasAny(tokens, {ids:Array(String)}))
     ORDER BY block_time, receipt_id, log_index, item`,
    { from, to, ids: `[${assetIds.map(id => `'${id.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`).join(",")}]` });
  return [...Map.groupBy(rows.map(diffFromRow), diff => diff.receiptId).values()];
}

type RestDeps = { catalog?: () => Promise<IntentsCatalog> };

/**
 * Candles in USD from stored intents: each receipt's route steps (or, when the route doesn't
 * connect, its user swaps) that involve the market's asset, priced by the other side: $1 for
 * reviewed stablecoins, else that asset's exchange 1m close. History before the switch minute
 * comes from the Explorer + FastNEAR backfill into the same table, so one derivation serves both.
 */
export function createIntentsRest(context: VenueContext, deps: RestDeps = {}): VenueRest {
  const catalog = deps.catalog ?? catalogLoader();
  const { clickhouse } = context;
  const marketOf = async (symbol: string) => {
    const resolved = await catalog();
    const market = resolved.markets.get(symbol);
    if (!market) throw new Error(`Unknown Intents market: ${symbol}`);
    return { resolved, ...market };
  };
  return {
    async instruments() {
      const seed = await readRegistrySeed();
      return seed.assets.flatMap(asset => asset.sources.filter(source => source.venue === "intents"))
        .map(source => ({ symbol: source.symbol, base: source.base, quote: source.quote, status: "TRADING" }));
    },
    async candles(symbol, resolution, from, to) {
      if (resolution !== "1m") throw new Error("Intents stores 1m candles only");
      const { resolved, group } = await marketOf(symbol);
      const state = await loadIntentsState(clickhouse);
      if (state.cursor === null || state.switchAt === null) return { klines: [], coveredTo: from };
      let end = Math.min(to, from + DAY, floorMinute(state.cursor.time));
      // With the Explorer key, minutes wait until every swap settled by transfers in them is stored.
      if (context.intentsExplorerJwt) end = state.settlements === null ? from : Math.min(end, floorMinute(state.settlements));
      if (end <= from) return { klines: [], coveredTo: from };
      const assetIds = resolved.assetIds(group);
      const [receipts, settlements] = await Promise.all([
        receiptsTouching(clickhouse, assetIds, from, end), storedSettlements(clickhouse, from, end, assetIds),
      ]);
      const derived = [
        ...receipts.map(diffs => ({ time: diffs[0]!.time, trades: receiptTrades(diffs, resolved.resolve).trades })),
        ...settlements.map(settlement => ({ time: settlement.time, trades: settlementTrades(settlement, resolved.resolve).trades })),
      ].sort((a, b) => a.time - b.time);
      const quoteGroups = new Set(derived.flatMap(entry => entry.trades.flatMap(trade => [trade.sold.group, trade.bought.group])).filter(other => other !== group));
      const rates = await historicalRates(clickhouse, resolved.quotes, quoteGroups, from, end);
      // A minute whose quote rate no market has stored yet ends the page there.
      for (const entry of derived) {
        for (const trade of entry.trades) {
          const other = trade.sold.group === group ? trade.bought.group : trade.bought.group === group ? trade.sold.group : undefined;
          if (other && other !== USD && rates.at(other, entry.time) === undefined && rates.pending(other, entry.time)) end = Math.min(end, floorMinute(entry.time));
        }
      }
      if (end <= from) return { klines: [], coveredTo: from };
      const bars = new Map<number, TradeBar>();
      for (const entry of derived) {
        if (entry.time >= end) break;
        for (const route of entry.trades) {
          const trade = marketTrade(route, group, entry.time, other => rates.at(other, entry.time));
          if (!trade || trade === "unpriced") continue;
          const minute = floorMinute(trade.time), bar = bars.get(minute);
          if (bar) bar.add(trade); else bars.set(minute, new TradeBar(trade, FIELDS));
        }
      }
      return { klines: [...bars.values()].map(bar => bar.snapshot()), coveredTo: end };
    },
    async earliest(symbol) {
      await marketOf(symbol);
      const { switchAt, backfill } = await loadIntentsState(clickhouse);
      if (switchAt === null) return null;
      const target = switchAt - HISTORY_MS;
      // Without the Explorer key there is no history; with it, markets start once the backfill is done.
      if (!context.intentsExplorerJwt) return switchAt;
      if (backfill === null || backfill > target) return null;
      return Math.min(switchAt, Math.ceil((target + BACKFILL_MARGIN_MS) / MINUTE) * MINUTE);
    },
    async nativeCandles() {
      throw new Error("Intents has no native candles; its candles are derived from stored intents");
    },
  };
}

function openIntentsStream(context: VenueContext, symbols: readonly string[], sink: LiveSink): { close(): void } {
  const redis = new RedisClient(context.redisUrl);
  const catalog = catalogLoader();
  const timers: Timer[] = [];
  const pending = new Map<string, { diffs: IntentDiff[]; height: number; at: number }>();
  const rates = new Map<string, { openTime: number; close: bigint }>();
  const wanted = new Set<string>();
  let markets = new Map<string, string>();
  let stopped = false;
  let backfill: IntentsBackfill | undefined;
  let settlements: IntentsSettlements | undefined;

  const loop = (name: string, task: () => Promise<void>, every: number) => {
    const run = () => { if (!stopped) task().catch(error => log(`intents.${name}.failed`, { error: String(error) }, "error")); };
    run();
    timers.push(setInterval(run, every));
  };

  // Newest stored-or-live minute of each quote asset's best exchange market.
  const refreshRates = async () => {
    const resolved = await catalog();
    for (const group of wanted) {
      for (const source of resolved.quotes.get(group) ?? []) {
        const recent = await redis.hgetall(liveKeys(source.venue).recent(source.symbol));
        const latest = Object.keys(recent).map(Number).filter(Number.isFinite).sort((a, b) => b - a)[0];
        if (latest === undefined) continue;
        rates.set(group, { openTime: latest, close: units(String(prop(JSON.parse(recent[String(latest)]!), "close"))) });
        break;
      }
    }
  };

  const publish = async (time: number, routes: readonly RouteTrade[]) => {
    for (const route of routes) {
      for (const [symbol, group] of markets) {
        const trade = marketTrade(route, group, time, other => {
          wanted.add(other);
          const rate = rates.get(other);
          return rate && Date.now() - rate.openTime <= QUOTE_STALE_MS ? rate.close : undefined;
        });
        if (trade && trade !== "unpriced") sink.trade(symbol, trade);
      }
    }
  };
  const publishReceipt = async (diffs: IntentDiff[]) => publish(diffs[0]!.time, receiptTrades(diffs, (await catalog()).resolve).trades);
  // Settled swaps are listed a minute or two after their payout: trades for minutes already
  // published live are left to the settled candles.
  const publishSettlements = async (stored: readonly StoredSettlement[]) => {
    if (!markets.size) return;
    const { resolve } = await catalog();
    for (const settlement of [...stored].sort((a, b) => a.time - b.time)) await publish(settlement.time, settlementTrades(settlement, resolve).trades);
  };

  const drain = (force: boolean) => {
    const newest = Math.max(0, ...[...pending.values()].map(entry => entry.height));
    for (const [receipt, entry] of pending) {
      if (!force && entry.height >= newest && Date.now() - entry.at < RECEIPT_WAIT_MS) continue;
      pending.delete(receipt);
      void publishReceipt(entry.diffs).catch(error => sink.invalid(`Intents trade derivation failed: ${String(error)}`));
    }
  };

  const rows = (diffs: IntentDiff[]) => {
    // No markets until the catalog loads; the diffs are still stored and candles derive from them.
    if (!markets.size) return;
    for (const diff of diffs) {
      const entry = pending.get(diff.receiptId);
      if (entry) entry.diffs.push(diff); else pending.set(diff.receiptId, { diffs: [diff], height: diff.height, at: Date.now() });
    }
    drain(false);
  };

  const blocks = valkeyNearBlocks(context.redisUrl);
  const indexer = new NearLogIndexer(intentsSource, { clickhouse: context.clickhouse, blocks, neardata: context.neardata },
    { rows, connected: sink.connected, invalid: sink.invalid });
  void (async () => {
    await redis.connect();
    if (stopped) return;
    // Storing raw diffs needs no catalog, so a 1Click outage at start never stalls the indexer.
    await indexer.start();
    // The backfill and settled swaps start once the switch minute is fixed, and resume after restarts.
    if (context.intentsExplorerJwt) {
      const sources = new IntentsSources({ explorerJwt: context.intentsExplorerJwt, fastnearApiKey: context.neardata.apiKey });
      const start = async () => {
        const { switchAt } = await loadIntentsState(context.clickhouse);
        if (switchAt === null || stopped) return false;
        backfill = new IntentsBackfill({ clickhouse: context.clickhouse, sources, target: switchAt - HISTORY_MS, invalid: sink.invalid });
        void backfill.run().catch(error => log("intents.backfill.failed", { error: String(error) }, "error"));
        settlements = new IntentsSettlements({
          clickhouse: context.clickhouse, sources, target: switchAt - BACKFILL_MARGIN_MS, invalid: sink.invalid,
          stored: stored => void publishSettlements(stored).catch(error => sink.invalid(`Intents settlement trades failed: ${String(error)}`)),
        });
        void settlements.run().catch(error => log("intents.settlements.failed", { error: String(error) }, "error"));
        return true;
      };
      const wait = setInterval(() => void start().then(started => { if (started) clearInterval(wait); }), 10_000);
      timers.push(wait);
    }
    let resolved: IntentsCatalog | undefined;
    while (!stopped && !resolved) {
      try { resolved = await catalog(); }
      catch (error) {
        log("intents.catalog.unavailable", { error: String(error), retryMs: CATALOG_RETRY_MS }, "warn");
        await Bun.sleep(CATALOG_RETRY_MS);
      }
    }
    if (!resolved) return;
    markets = new Map(symbols.flatMap(symbol => {
      const market = resolved.markets.get(symbol);
      if (!market) { sink.invalid(`Unknown Intents market: ${symbol}`); return []; }
      return [[symbol, market.group] as const];
    }));
    loop("rates", refreshRates, 2_000);
    loop("tickers", () => publishRollingTickers(context.clickhouse, redis, "intents", [...markets.keys()], sink), TICKER_MS);
    loop("coverage", async () => { await updateCoverage(context.clickhouse, await catalog(), await loadIntentsState(context.clickhouse), undefined, !!context.intentsExplorerJwt); }, COVERAGE_MS);
    timers.push(setInterval(() => drain(false), 1_000));
  })().catch(error => sink.invalid(`Intents stream failed to start: ${String(error)}`));

  return {
    close() {
      stopped = true;
      for (const timer of timers) clearInterval(timer);
      backfill?.stop();
      settlements?.stop();
      drain(true);
      void indexer.close().finally(() => { blocks.close(); redis.close(); });
      sink.connected(false);
    },
  };
}

export const intents: Venue = {
  id: "intents", label: "NEAR Intents",
  // Intents markets come from the registry's reviewed Intents sources, never from CoinGecko exchange tickers.
  coinGeckoId: "",
  history: ["1m"], fields: FIELDS,
  parityIntervals: [],
  // Minutes settle once every swap 1Click settled by transfers in them is listed: the settlements
  // watermark trails by five minutes, the sync by a minute or two more.
  maxSyncLagMs: 10 * MINUTE,
  // REST is our own store (no venue REST); live intents come from the NEAR block feed.
  defaults: { restUrl: "https://explorer.near-intents.org/api/v0", streamUrl: "", budget: 12 },
  // Registry symbols may carry characters market ids don't allow ($WIF → WIF_USD).
  symbol: (base, quote) => `${base}_${quote}`.toUpperCase().replace(/[^A-Z0-9_-]/g, ""),
  rest: (_options, context) => createIntentsRest(context),
  live: (_options, _rest, context) => ({ open: (symbols, sink) => openIntentsStream(context, symbols, sink) }),
};
