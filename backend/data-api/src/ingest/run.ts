import { RedisClient } from "bun";
import type { ClickHouse } from "../clickhouse";
import type { Config } from "../config";
import { MINUTE } from "../candles/kline";
import { liveKeys, RECENT_RETENTION_MS, type IngestStatus, type Ticker } from "../live/protocol";
import { log } from "../log";
import { registrySymbols } from "../registry";
import type { LiveSink, Venue } from "../venues/types";
import { MinuteFolder } from "./minutes";
import { KlineSync } from "./sync";

const INSTRUMENTS_REFRESH_MS = 60 * MINUTE;
// Venues push tickers up to every 50 ms; clients need about one per second.
const TICKER_INTERVAL_MS = 1000;
// A sync pass stops backfilling after this long so caught-up symbols advance every pass; minutes
// must reach ClickHouse well within Valkey's 15-minute live retention.
const SYNC_PASS_MS = 45_000;

/**
 * One ingest process per venue:
 * - REST sync: full-history backfill, then one pass shortly after every minute closes.
 *   This is the only writer of ClickHouse candles.
 * - WebSocket: trades folded into the open minute and 24h tickers per tradable symbol,
 *   published to Redis for API processes. Live data is never written to ClickHouse.
 */
export async function runIngest(config: Config, clickhouse: ClickHouse, venue: Venue): Promise<() => Promise<void>> {
  const symbols = config.symbols.length ? config.symbols : await registrySymbols(venue.id);
  const redis = new RedisClient(config.redisUrl);
  await redis.connect();
  const keys = liveKeys(venue.id);
  const options = config.venues[venue.id]!;
  const context = { clickhouse, redisUrl: config.redisUrl, intentsExplorerJwt: config.intentsExplorerJwt, neardata: config.neardata };
  const rest = venue.rest(options, context);
  const sync = new KlineSync({ clickhouse, rest, venue });
  const folder = new MinuteFolder(venue.fields, async event => {
    await redis.hset(keys.recent(event.symbol), { [event.kline.openTime]: JSON.stringify(event.kline) });
    await redis.publish(keys.klines, JSON.stringify(event));
  });
  const status: IngestStatus = { at: 0, startedAt: Date.now(), connected: false, lastEventAt: null, syncedTo: {}, errors: {} };
  const tickers = new Map<string, { latest: Ticker; publishedAt: number; timer: Timer | undefined }>();
  let stream: { close(): void } | undefined;
  let streamed = "";
  let listed: string[] = [];
  let stopped = false;
  let backfilling = false;

  const publishTicker = (symbol: string) => {
    const entry = tickers.get(symbol)!;
    entry.timer = undefined;
    entry.publishedAt = Date.now();
    const json = JSON.stringify(entry.latest);
    redis.hset(keys.tickers, { [symbol]: json }).then(() => redis.publish(keys.tickerUpdates, json))
      .catch(error => log("ingest.redis.failed", { error: String(error) }, "error"));
  };

  const sink: LiveSink = {
    connected: (connected: boolean) => { status.connected = connected; },
    invalid: (detail: string) => log("ingest.stream.invalid", { venue: venue.id, detail }, "error"),
    trade: (symbol, trade) => {
      status.lastEventAt = Date.now();
      folder.apply(symbol, trade);
    },
    ticker: ticker => {
      status.lastEventAt = Date.now();
      const entry = tickers.get(ticker.symbol);
      if (!entry) {
        tickers.set(ticker.symbol, { latest: ticker, publishedAt: 0, timer: undefined });
        return publishTicker(ticker.symbol);
      }
      entry.latest = ticker;
      const delay = entry.publishedAt + TICKER_INTERVAL_MS - Date.now();
      if (delay <= 0) publishTicker(ticker.symbol);
      else entry.timer ??= setTimeout(() => publishTicker(ticker.symbol), delay);
    },
  };

  const refreshInstruments = async () => {
    const wanted = new Set(symbols);
    const instruments = (await rest.instruments()).filter(instrument => wanted.has(instrument.symbol));
    const updatedAt = String(Date.now());
    await clickhouse.insert("instruments", instruments.map(instrument => ({ venue: venue.id, ...instrument, updated_at: updatedAt })));
    listed = instruments.map(instrument => instrument.symbol);
    const missing = symbols.filter(symbol => !listed.includes(symbol));
    if (missing.length) log("ingest.instruments.missing", { venue: venue.id, missing }, "warn");
    const tradable = instruments.filter(instrument => instrument.status === "TRADING").map(instrument => instrument.symbol).sort();
    if (tradable.join() === streamed) return;
    stream?.close();
    streamed = tradable.join();
    stream = tradable.length ? venue.live(options, rest, context).open(tradable, sink) : undefined;
  };

  const pruneRecent = async () => {
    const cutoff = Date.now() - RECENT_RETENTION_MS;
    for (const symbol of listed) {
      const key = keys.recent(symbol);
      const stale = (await redis.hkeys(key)).filter(field => Number(field) < cutoff);
      if (stale.length) await redis.hdel(key, stale[0]!, ...stale.slice(1));
    }
  };

  const publishStatus = async () => {
    status.at = Date.now();
    await redis.set(keys.status, JSON.stringify(status), "EX", 60);
  };

  // Long-running loops; each iteration logs and survives transient failures.
  const loop = async (name: string, task: () => Promise<void>, delay: () => number) => {
    while (!stopped) {
      try { await task(); } catch (error) { log(`ingest.${name}.failed`, { venue: venue.id, error: String(error) }, "error"); }
      await Bun.sleep(delay());
    }
  };

  await refreshInstruments();
  const loops = [
    loop("instruments", refreshInstruments, () => INSTRUMENTS_REFRESH_MS).catch(() => {}),
    loop("sync", async () => {
      const started = Date.now();
      const results = await sync.syncAll(listed, started + SYNC_PASS_MS);
      backfilling = results.some(result => result.pending);
      status.errors = {};
      for (const result of results) {
        status.syncedTo[result.symbol] = result.syncedTo;
        if (result.error) status.errors[result.symbol] = result.error;
      }
      const rows = results.reduce((sum, result) => sum + result.rows, 0);
      if (rows > results.length * 5 || Object.keys(status.errors).length) {
        log("ingest.sync", { venue: venue.id, rows, ms: Date.now() - started, backfilling, errors: status.errors });
      }
    }, () => backfilling ? 0 : MINUTE - (Date.now() % MINUTE) + 12_000),
    loop("prune", pruneRecent, () => MINUTE),
    loop("status", publishStatus, () => 5000),
  ];

  return async () => {
    stopped = true;
    stream?.close();
    for (const entry of tickers.values()) clearTimeout(entry.timer);
    await folder.stop();
    await Promise.race([Promise.all(loops), Bun.sleep(2000)]);
    redis.close();
  };
}
