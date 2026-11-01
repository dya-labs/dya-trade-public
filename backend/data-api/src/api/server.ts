import { RedisClient, type Server } from "bun";
import type { ClickHouse } from "../clickhouse";
import type { Config } from "../config";
import { wireBar } from "../candles/bar";
import { anchorFor, INTERVALS, pageBounds, pageIndex, PAGE_SIZE } from "../candles/intervals";
import { CandleStore, firstFor, type Market } from "../candles/store";
import { API_STARTED_KEY, liveKeys, MAX_SYNC_LAG_MS, type IngestStatus, type Ticker } from "../live/protocol";
import { log } from "../log";
import { BarReader } from "./bars";
import { createStream, type StreamData } from "./stream";
import { clientIp } from "./client-ip";
import { SharedLimits, limitHeaders, type Lease } from "./limits";
import { QueryCache } from "./cache";
import { QueueTimeout, Semaphore } from "./semaphore";
import { Admission, loadRegistry } from "../registry";
import type { RegistryAsset } from "../registry-types";
import { VENUES } from "../venues";
import { loadIntentsState } from "../venues/intents/indexer";
import { recentTrades } from "../venues/intents/recent";
import { catalogLoader } from "../venues/intents/venue";
import { TOKEN_LINKS_KEY } from "../markets/token-links";
import { TOKEN_MARKETS_KEY } from "../markets/token-markets";

const VENUE_IDS = Object.keys(VENUES);
const REVISION = process.env.DATA_REVISION?.trim() || "1";
type CachedPage = { body: string; final: boolean; count: number };
// A listed market whose stored history ends further back is dropped: its chart would have a hole
// up to the live edge. A market is first listed only once it caught up (`market_caught_up`), so a
// first backfill never shows; after that it stays listed through shorter outages.
const LISTING_LAG_MS = 24 * 60 * 60_000;

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Single-use query params: unknown or repeated keys are rejected. */
function params(url: URL, allowed: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    if (!allowed.includes(key) || values.length !== 1) throw new HttpError(400, `Unsupported or repeated parameter: ${key}`);
    result[key] = values[0]!;
  }
  return result;
}

function integer(value: string | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new HttpError(400, `${name} must be an integer in [${min}, ${max}]`);
  return parsed;
}

/** Read-only token metadata route; the dedicated fetch role owns the snapshot. */
export async function tokenMarketsResponse(redis: Pick<RedisClient, "get">, request: Request): Promise<Response> {
  params(new URL(request.url), []);
  const body = await redis.get(TOKEN_MARKETS_KEY);
  if (body === null) return Response.json({
    error: "Token market data temporarily unavailable",
    requestId: request.headers.get("cf-ray") || crypto.randomUUID(),
    revision: REVISION,
  }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2" } });
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } });
}

export async function runApi(config: Config, clickhouse: ClickHouse): Promise<() => Promise<void>> {
  const redis = new RedisClient(config.redisUrl);
  await redis.connect();
  const subscriber = await redis.duplicate();
  const queries = new Semaphore();
  const store = new CandleStore(clickhouse, queries);
  const reader = new BarReader({ store, redis });
  /** Latest ticker per market id. */
  const tickers = new Map<string, Ticker>();
  let markets = new Map<string, Market>();
  let assets: RegistryAsset[] = await queries.run(() => loadRegistry(clickhouse, REVISION));
  let server: Server<StreamData> | undefined;

  const admission = new Admission();
  // A failed refresh keeps the previous listing; a 1Click outage is absorbed by `admission`.
  const refreshMarkets = async () => {
    const registered = await queries.run(() => loadRegistry(clickhouse, REVISION));
    const prices = new Map([...tickers].map(([id, ticker]) => [id, Number(ticker.lastPrice)]));
    const admitted = await admission.run(registered, prices);
    const allowed = new Set(admitted.flatMap(asset => asset.sources.map(source => source.id)));
    const stored = await store.markets();
    assets = admitted;
    markets = new Map(stored
      .filter(found => found.caughtUp && found.coverage.syncedTo >= Date.now() - LISTING_LAG_MS)
      .map(found => [`${found.venue}:${found.symbol}`, found] as const)
      .filter(([id]) => allowed.has(id)));
  };
  for (const venue of VENUE_IDS) {
    for (const [symbol, json] of Object.entries(await redis.hgetall(liveKeys(venue).tickers))) tickers.set(`${venue}:${symbol}`, JSON.parse(json) as Ticker);
  }
  await refreshMarkets().catch(error => log("api.markets.admission", { error: String(error) }, "error"));
  /** The earliest stored candle across tiers: the 3d grid anchor and the market's advertised start. */
  const firstOpenTime = (found: Market) => firstFor(found.coverage, "1M")!;
  const stream = await createStream({ venues: VENUE_IDS, reader, subscriber, redis, clientIpHeader: config.api.clientIpHeader, market: id => {
    const found = markets.get(id);
    return found ? { id, venue: found.venue, symbol: found.symbol, firstOpenTime: firstOpenTime(found) } : undefined;
  }, tickers });
  const timers = [
    setInterval(() => void refreshMarkets().catch(error => log("api.markets.refresh", { error: String(error) }, "error")), 60_000),
  ];

  const market = (id: string | undefined): Market => {
    const found = id === undefined ? undefined : markets.get(id);
    if (!found) throw new HttpError(404, "Unknown market");
    return found;
  };
  const assetIdOf = (id: string) => assets.find(asset => asset.sources.some(source => source.id === id))?.assetId;

  const intentsCatalog = catalogLoader();
  /** A listed NEAR Intents market's newest trades (see `recentTrades`), cached for two seconds. */
  const recentCache = new QueryCache<string>();

  /** NEAR Intents derivation coverage per UTC day (see `intents_coverage`), cached for a minute. */
  const coverageCache = new Map<number, { at: number; body: unknown }>();
  const intentsCoverage = async (days: number) => {
    const cached = coverageCache.get(days);
    if (cached && Date.now() - cached.at < 60_000) return cached.body;
    const from = Date.now() - days * 86_400_000;
    const [state, statuses, gaps] = await queries.run(() => Promise.all([
      loadIntentsState(clickhouse),
      clickhouse.query<{ day: string; status: string; receipts: number; trades: number; unpriced: number }>(
        `SELECT toString(toDate(hour)) AS day, status, sum(receipts) AS receipts, sum(trades) AS trades, sum(unpriced) AS unpriced
         FROM intents_coverage FINAL WHERE hour >= fromUnixTimestamp64Milli({from:Int64}, 'UTC') GROUP BY day, status ORDER BY day, status`, { from }),
      clickhouse.query<{ day: string; swaps: number }>(
        "SELECT toString(toDate(created_at)) AS day, count() AS swaps FROM intents_gaps FINAL WHERE created_at >= fromUnixTimestamp64Milli({from:Int64}, 'UTC') GROUP BY day", { from }),
    ]));
    const byDay = new Map<string, { day: string; statuses: Record<string, { receipts: number; trades: number; unpriced: number }>; unrecoverableSwaps: number }>();
    const day = (key: string) => { let entry = byDay.get(key); if (!entry) byDay.set(key, entry = { day: key, statuses: {}, unrecoverableSwaps: 0 }); return entry; };
    for (const row of statuses) if (row.status !== "none") day(row.day).statuses[row.status] = { receipts: Number(row.receipts), trades: Number(row.trades), unpriced: Number(row.unpriced) };
    for (const row of gaps) day(row.day).unrecoverableSwaps = Number(row.swaps);
    const body = {
      scope: "Public NEAR Intents executions; confidential swaps are not visible.",
      switchAt: state.switchAt, cursor: state.cursor?.time ?? null, backfill: state.backfill,
      days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    };
    coverageCache.set(days, { at: Date.now(), body });
    return body;
  };

  const cache = new QueryCache<CachedPage>();
  const candles = async (url: URL): Promise<CachedPage> => {
    const latest = url.pathname === "/v1/candles/latest";
    const query = params(url, latest ? ["market", "interval"] : ["market", "interval", "page", "rev"]);
    if (!latest && query.rev !== REVISION) throw new HttpError(400, `rev must equal current revision ${REVISION}; read /v1/meta`);
    const found = market(query.market);
    const interval = query.interval ?? "";
    if (!Object.hasOwn(INTERVALS, interval)) throw new HttpError(400, `interval must be one of ${Object.keys(INTERVALS).join(", ")}`);
    const anchor = anchorFor(interval, firstOpenTime(found));
    // Venues with short 1m retention start intraday intervals later; pages before that are empty.
    const first = pageIndex(interval, firstFor(found.coverage, interval)!, anchor);
    const newest = pageIndex(interval, Date.now(), anchor);
    const page = latest ? newest : integer(query.page, "page", 0, newest);
    if (page === undefined) throw new HttpError(400, "page is required");
    const { from, end } = pageBounds(interval, page, anchor);
    return cache.get(`${REVISION}:${query.market}:${interval}:${page}`, async () => {
      const { bars, final } = page < first ? { bars: [], final: true } : await reader.read(found, interval, anchor, from, end);
      const body = JSON.stringify({ market: query.market, interval, revision: REVISION, page, prev: page <= first ? null : page - 1, final, bars: bars.map(wireBar) });
      return { value: { body, final, count: bars.length }, ttlMs: final ? 3_600_000 : 2000 };
    });
  };

  const health = async () => {
    const now = Date.now();
    const venues: Record<string, { stream: IngestStatus | null; syncLagMs: Record<string, number>; maxSyncLagMs: number; behind: string[]; ok: boolean }> = {};
    for (const found of markets.values()) {
      if (!venues[found.venue]) {
        const raw = await redis.get(liveKeys(found.venue).status);
        venues[found.venue] = { stream: raw ? JSON.parse(raw) as IngestStatus : null, syncLagMs: {}, maxSyncLagMs: 0, behind: [], ok: false };
      }
      const entry = venues[found.venue]!;
      const lag = now - (entry.stream?.syncedTo[found.symbol] ?? found.coverage.syncedTo);
      entry.syncLagMs[found.symbol] = lag;
      entry.maxSyncLagMs = Math.max(entry.maxSyncLagMs, lag);
      const limit = VENUES[found.venue]?.maxSyncLagMs ?? MAX_SYNC_LAG_MS;
      if (lag > limit) entry.behind.push(found.symbol);
    }
    for (const entry of Object.values(venues)) entry.ok = !!entry.stream?.connected && entry.behind.length === 0;
    // Only an API that can't serve charts is down (503). A venue that's disconnected or behind,
    // or 1Click being unreachable (`degraded`), leaves charts serving, so it's "degraded" (200).
    const status = markets.size === 0 ? "down" : admission.degraded || !Object.values(venues).every(entry => entry.ok) ? "degraded" : "ok";
    return Response.json({ status, venues, markets: markets.size, degraded: admission.degraded }, { status: status === "down" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  };

  const limits = new SharedLimits(redis);

  const corsHeaders = (origin: string | null): Record<string, string> =>
    origin && config.api.corsOrigins.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };

  server = Bun.serve<StreamData>({
    port: config.api.port,
    reusePort: true,
    async fetch(request, server) {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      const cors = corsHeaders(origin);
      let lease: Lease | undefined;
      let renewal: Timer | undefined;
      try {
        if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
        // Liveness answers before admission: container healthchecks have no proxy client-IP header.
        if (url.pathname === "/healthz") {
          params(url, []);
          const response = await health();
          for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
          return response;
        }
        let ip: string;
        try { ip = clientIp(request, server.requestIP(request)?.address, config.api.clientIpHeader); }
        catch { throw new HttpError(400, "Missing or invalid client IP"); }
        if (url.pathname === "/v1/stream") {
          // Browsers always send Origin; only listed origins may open streams. Servers send none.
          if (origin && !config.api.corsOrigins.includes(origin)) throw new HttpError(403, "Origin not allowed");
          if (await stream.upgrade(request, server)) return undefined;
          throw new HttpError(426, "WebSocket upgrade required");
        }
        lease = await limits.acquire(`rest:concurrent:${ip}`, 20, 30_000);
        if (!lease) return Response.json({ error: "concurrent_requests" }, { status: 429, headers: { ...cors, ...limitHeaders({ allowed: false, limit: 20, remaining: 0, retryAfter: 1 }), "Cache-Control": "no-store" } });
        renewal = setInterval(() => void lease?.renew().catch(error => log("api.lease.renew", { error: String(error) }, "error")), 10_000);
        let budget = await limits.consume(`rest:weight:${ip}`, 1, config.api.rateLimitPerMinute, 60_000);
        if (!budget.allowed) return Response.json({ error: "weight_exceeded" }, { status: 429, headers: { ...cors, ...limitHeaders(budget), "Cache-Control": "no-store" } });
        let response: Response;
        if (url.pathname === "/v1/candles" || url.pathname === "/v1/candles/latest") {
          const page = await candles(url);
          const extra = Math.ceil(page.count / 100);
          if (extra) {
            budget = await limits.consume(`rest:weight:${ip}`, extra, config.api.rateLimitPerMinute, 60_000);
            if (!budget.allowed) return Response.json({ error: "weight_exceeded" }, { status: 429, headers: { ...cors, ...limitHeaders(budget), "Cache-Control": "no-store" } });
          }
          response = new Response(page.body, { headers: { "Content-Type": "application/json", "Cache-Control": page.final && url.pathname === "/v1/candles" ? "public, max-age=31536000, immutable" : "public, max-age=2" } });
        }
        else if (url.pathname === "/v1/token-links") {
          params(url, []);
          const body = await redis.get(TOKEN_LINKS_KEY);
          response = new Response(body ?? JSON.stringify({ updatedAt: 0, assets: {} }), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
        }
        else if (url.pathname === "/v1/token-markets") {
          response = await tokenMarketsResponse(redis, request);
        }
        else if (url.pathname === "/v1/markets") {
          params(url, []);
          response = Response.json({
            intervals: Object.keys(INTERVALS),
            markets: [...markets.entries()].map(([id, found]) => ({
              id, venue: found.venue, sourceLabel: VENUES[found.venue]?.label ?? found.venue, symbol: found.symbol, base: found.base, quote: found.quote,
              assetId: assetIdOf(id), status: found.status, firstOpenTime: firstOpenTime(found), intervals: Object.keys(INTERVALS),
            })),
            degraded: admission.degraded,
          }, { headers: { "Cache-Control": "public, max-age=60" } });
        } else if (url.pathname === "/v1/assets") {
          params(url, []);
          response = Response.json({ assets: assets.map(asset => {
            const available = asset.sources.filter(source => markets.has(source.id));
            const primary = available[0];
            return { ...asset, primaryMarket: primary?.id ?? null, alternatives: available.slice(1).map(source => source.id), sourceLabel: primary ? VENUES[primary.venue]?.label ?? primary.venue : null, unavailableReason: primary ? null : asset.unavailableReason ?? "History not yet synced" };
          }) }, { headers: { "Cache-Control": "public, max-age=60" } });
        } else if (url.pathname === "/v1/tickers") {
          const query = params(url, ["markets"]);
          // The default lists every market; an explicit list is capped.
          const ids = query.markets?.split(",") ?? [...markets.keys()];
          if (query.markets !== undefined && ids.length > 100) throw new HttpError(400, "At most 100 markets");
          const rows = ids.flatMap(id => {
            market(id);
            const ticker = tickers.get(id);
            return ticker ? [{ ...ticker, market: id }] : [];
          });
          response = Response.json({ tickers: rows }, { headers: { "Cache-Control": "public, max-age=1" } });
        } else if (url.pathname === "/v1/meta") {
          params(url, []);
          response = Response.json({ serverTime: Date.now(), intervals: Object.keys(INTERVALS), pageSize: PAGE_SIZE, revision: REVISION, limits: { restConcurrent: 20, restWeightPerMinute: config.api.rateLimitPerMinute, weights: { request: 1, candleBarsPerExtraWeight: 100 }, clickhouseConcurrent: 8, clickhouseQueueTimeoutMs: 2000 } }, { headers: { "Cache-Control": "public, max-age=60" } });
        }
        else if (url.pathname === "/v1/intents/coverage") {
          const query = params(url, ["days"]);
          const days = query.days === undefined ? 7 : Number(query.days);
          if (!Number.isInteger(days) || days < 1 || days > 180) throw new HttpError(400, "days must be an integer in [1, 180]");
          response = Response.json(await intentsCoverage(days), { headers: { "Cache-Control": "public, max-age=60" } });
        }
        else if (url.pathname === "/v1/intents/trades") {
          const query = params(url, ["market", "limit"]);
          const found = market(query.market);
          if (found.venue !== "intents") throw new HttpError(404, "Not a NEAR Intents market");
          const limit = query.limit === undefined ? 50 : Number(query.limit);
          if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "limit must be an integer in [1, 100]");
          const body = await recentCache.get(`${found.symbol}:${limit}`, async () => ({
            value: JSON.stringify({ market: query.market, trades: await queries.run(async () => recentTrades(clickhouse, await intentsCatalog(), found.symbol, limit)) ?? [] }),
            ttlMs: 2_000,
          }));
          response = new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=2" } });
        }
        else throw new HttpError(404, "Not found");
        for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
        return response;
      } catch (error) {
        // Cloudflare's Ray ID when proxied (it also appears in Cloudflare's logs), otherwise random.
        const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
        if (!(error instanceof HttpError)) log("api.request.failed", { requestId, path: url.pathname, error: String(error), stack: error instanceof Error ? error.stack : undefined }, "error");
        const status = error instanceof HttpError ? error.status : 503;
        return Response.json({ error: error instanceof HttpError || error instanceof QueueTimeout ? error.message : "Data temporarily unavailable", requestId, revision: REVISION }, { status, headers: { ...cors, "Cache-Control": "no-store", ...(status === 503 ? { "Retry-After": "2" } : {}) } });
      } finally {
        clearInterval(renewal);
        await lease?.release().catch(error => log("api.lease.release", { error: String(error) }, "error"));
      }
    },
    websocket: stream.websocket,
  });
  stream.attach(server);
  log("api.listening", { port: server.port, pid: process.pid });
  // Workers are children of the main process, so its start marks every API (re)start.
  if (!process.env.DATA_API_WORKER) await redis.set(API_STARTED_KEY, String(Date.now()));

  return async () => {
    for (const timer of timers) clearInterval(timer);
    stream.stop();
    await server?.stop();
    subscriber.close();
    redis.close();
  };
}
