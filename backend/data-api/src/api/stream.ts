import type { RedisClient, Server, ServerWebSocket, WebSocketHandler } from "bun";
import type { WireBar } from "../candles/bar";
import { anchorFor, INTERVALS } from "../candles/intervals";
import { prop } from "../json";
import { liveKeys, type KlineEvent, type Ticker } from "../live/protocol";
import { log } from "../log";
import type { BarReader } from "./bars";
import { LiveBars, type LiveMarket } from "./live";
import { SharedLimits, type Lease } from "./limits";
import { clientIp } from "./client-ip";

type Subscription = { type: "candle"; market: string; interval: string } | { type: "ticker"; market: string };
type Active = { subscription: Subscription; seq: number; lease: Lease; ready: boolean; sentAt: number; pending: Map<number, { bar: WireBar; closed: boolean }>; timer?: Timer };
export type StreamData = { ip: string; lease?: Lease; rejected: boolean; closed: boolean; subscriptions: Map<string, Active>; messages: number; windowAt: number; chain: Promise<void> };
type Socket = ServerWebSocket<StreamData>;
export type StreamDeps = {
  venues: readonly string[]; reader: BarReader; subscriber: RedisClient; redis: RedisClient; clientIpHeader?: string;
  market: (id: string) => (LiveMarket & { firstOpenTime: number }) | undefined;
  /** Latest ticker per market id. */
  tickers: Map<string, Ticker>;
};
export type Stream = { upgrade(request: Request, server: Server<StreamData>): Promise<boolean>; websocket: WebSocketHandler<StreamData>; attach(server: Server<StreamData>): void; stop(): void };

export async function createStream({ venues, reader, subscriber, redis, clientIpHeader, market, tickers }: StreamDeps): Promise<Stream> {
  const limits = new SharedLimits(redis);
  const sockets = new Set<Socket>();
  let bound: Server<StreamData> | undefined;
  const references = new Map<string, number>();
  const error = (ws: Socket, code: string, subscription?: unknown, close?: number) => {
    ws.send(JSON.stringify({ channel: "error", data: { code, subscription } }));
    if (close) ws.close(close, code);
  };
  const candle = (ws: Socket, active: Active, bar: WireBar, closed: boolean, snapshot = false) => {
    if (ws.data.closed) return;
    active.sentAt = Date.now();
    const [t, o, h, l, c, v, q, n] = bar;
    ws.send(JSON.stringify({ channel: "candle", data: { market: active.subscription.market, interval: active.subscription.type === "candle" ? active.subscription.interval : undefined, seq: ++active.seq, isSnapshot: snapshot, bar: { t, o, h, l, c, v, q, n, x: closed } } }));
  };
  const flush = (ws: Socket, active: Active) => {
    active.timer = undefined;
    if (!active.ready || ws.data.closed) return;
    const remaining = active.sentAt + 250 - Date.now();
    if (remaining > 0) {
      active.timer = setTimeout(() => flush(ws, active), remaining);
      return;
    }
    const entry = active.pending.entries().next().value;
    if (!entry) return;
    active.pending.delete(entry[0]);
    candle(ws, active, entry[1].bar, entry[1].closed);
    if (active.pending.size) active.timer = setTimeout(() => flush(ws, active), 250);
  };
  const live = new LiveBars(reader, (id, interval, bar, closed = false) => {
    const key = `candle:${id}:${interval}`;
    for (const ws of sockets) {
      const active = ws.data.subscriptions.get(key);
      if (!active) continue;
      active.pending.set(bar[0], { bar, closed });
      if (active.ready && !active.timer) active.timer = setTimeout(() => flush(ws, active), Math.max(0, active.sentAt + 250 - Date.now()));
    }
  });
  for (const venue of venues) {
    const keys = liveKeys(venue);
    await subscriber.subscribe(keys.klines, message => live.onKline(venue, JSON.parse(message) as KlineEvent));
    await subscriber.subscribe(keys.tickerUpdates, message => {
      const ticker = JSON.parse(message) as Ticker;
      const id = `${venue}:${ticker.symbol}`;
      tickers.set(id, ticker);
      for (const ws of sockets) {
        const active = ws.data.subscriptions.get(`ticker:${id}`);
        if (active?.ready) ws.send(JSON.stringify({ channel: "ticker", data: { market: id, seq: ++active.seq, isSnapshot: false, ticker } }));
      }
    });
  }
  const release = async (key: string, active: Active) => {
    clearTimeout(active.timer);
    const count = (references.get(key) ?? 1) - 1;
    if (count > 0) references.set(key, count);
    else {
      references.delete(key);
      if (active.subscription.type === "candle") live.close(active.subscription.market, active.subscription.interval);
    }
    await active.lease.release();
  };
  const onMessage = async (ws: Socket, raw: string | Buffer) => {
    if (ws.data.closed) return;
    if (!(await limits.consume(`ws:messages:${ws.data.ip}`, 1, 2000, 60_000)).allowed) return error(ws, "rate_limited", undefined, 1008);
    let message: unknown;
    try { message = JSON.parse(String(raw)); } catch { return error(ws, "rate_limited", undefined, 1008); }
    const method = prop(message, "method"), input = prop(message, "subscription");
    if (method === "ping") { ws.send(JSON.stringify({ channel: "pong" })); return; }
    const type = prop(input, "type"), id = prop(input, "market"), interval = prop(input, "interval");
    if (method !== "subscribe" && method !== "unsubscribe") return error(ws, "rate_limited", input, 1008);
    const listed = typeof id === "string" ? market(id) : undefined;
    if (!listed) return error(ws, "unknown_market", input);
    if (type !== "ticker" && type !== "candle") return error(ws, "unsupported_interval", input);
    if (type === "candle" && (typeof interval !== "string" || !Object.hasOwn(INTERVALS, interval))) return error(ws, "unsupported_interval", input);
    const subscription: Subscription = type === "ticker" ? { type, market: listed.id } : { type, market: listed.id, interval: String(interval) };
    const key = `${type}:${listed.id}${subscription.type === "candle" ? `:${subscription.interval}` : ""}`;
    const ack = () => ws.send(JSON.stringify({ channel: "subscriptionResponse", data: { method, subscription } }));
    const previous = ws.data.subscriptions.get(key);
    if (method === "unsubscribe") {
      if (previous) { ws.data.subscriptions.delete(key); await release(key, previous); }
      ack(); return;
    }
    if (previous) { ack(); return; }
    if (ws.data.subscriptions.size >= 200) return error(ws, "too_many_subscriptions", subscription, 1008);
    const lease = await limits.acquire(`ws:subscriptions:${ws.data.ip}`, 1000, 90_000);
    if (!lease) return error(ws, "too_many_subscriptions", subscription, 1008);
    if (ws.data.closed) { await lease.release(); return; }
    const active: Active = { subscription, lease, seq: 0, ready: false, sentAt: 0, pending: new Map() };
    ws.data.subscriptions.set(key, active);
    references.set(key, (references.get(key) ?? 0) + 1);
    ack();
    if (subscription.type === "candle") {
      const bar = await live.open(listed, subscription.interval, anchorFor(subscription.interval, listed.firstOpenTime));
      if (bar) candle(ws, active, bar, false, true);
    } else {
      const ticker = tickers.get(listed.id);
      if (ticker) ws.send(JSON.stringify({ channel: "ticker", data: { market: listed.id, seq: ++active.seq, isSnapshot: true, ticker } }));
    }
    active.ready = true;
    if (active.pending.size && !active.timer) active.timer = setTimeout(() => flush(ws, active), 250);
  };
  const reseed = setInterval(() => void live.reseedStale().catch(cause => log("api.live.reseed", { error: String(cause) }, "error")), 5000);
  const keepalive = setInterval(() => {
    for (const ws of sockets) {
      ws.ping();
      void Promise.all([ws.data.lease?.renew(), ...[...ws.data.subscriptions.values()].map(active => active.lease.renew())]).then(results => {
        if (results.some(value => value === false)) error(ws, "rate_limited", undefined, 1013);
      }).catch(() => error(ws, "rate_limited", undefined, 1013));
    }
  }, 30_000);
  return {
    async upgrade(request, server) {
      if (server !== bound) throw new Error("Stream must be attached to its server");
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return false;
      const ip = clientIp(request, server.requestIP(request)?.address, clientIpHeader);
      let lease: Lease | undefined;
      let rejected = false;
      try {
        rejected = !(await limits.consume(`ws:new:${ip}`, 1, 30, 60_000)).allowed;
        if (!rejected) lease = await limits.acquire(`ws:connections:${ip}`, 10, 90_000);
        rejected ||= !lease;
      } catch { rejected = true; }
      const upgraded = server.upgrade(request, { data: { ip, lease, rejected, closed: false, subscriptions: new Map(), messages: 0, windowAt: 0, chain: Promise.resolve() } });
      if (!upgraded) await lease?.release();
      return upgraded;
    },
    websocket: {
      maxPayloadLength: 4096,
      backpressureLimit: 1024 * 1024,
      closeOnBackpressureLimit: true,
      idleTimeout: 180,
      sendPings: false,
      open(ws) { if (ws.data.rejected) error(ws, "rate_limited", undefined, 1013); else sockets.add(ws); },
      message(ws, raw) {
        if (ws.data.closed) return;
        const now = Date.now();
        if (now - ws.data.windowAt >= 1000) { ws.data.windowAt = now; ws.data.messages = 0; }
        if (++ws.data.messages > 20 || Buffer.byteLength(raw) > 4096) {
          error(ws, "rate_limited", undefined, 1008);
          ws.data.closed = true;
          return;
        }
        ws.data.chain = ws.data.chain.then(() => onMessage(ws, raw)).catch(() => error(ws, "rate_limited", undefined, 1013));
      },
      close(ws) {
        ws.data.closed = true;
        sockets.delete(ws);
        for (const [key, active] of ws.data.subscriptions) void release(key, active).catch(() => {});
        ws.data.subscriptions.clear();
        void ws.data.lease?.release().catch(() => {});
      },
    },
    attach(server) {
      if (bound) throw new Error("Stream is already attached");
      bound = server;
    },
    stop() { clearInterval(reseed); clearInterval(keepalive); for (const ws of sockets) ws.close(1001, "Server shutdown"); },
  };
}
