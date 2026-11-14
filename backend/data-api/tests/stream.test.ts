import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RedisClient, type Server, type ServerWebSocket } from "bun";
import { createStream, type Stream, type StreamData } from "../src/api/stream";
import { BarReader } from "../src/api/bars";
import { CandleStore } from "../src/candles/store";
import { ClickHouse } from "../src/clickhouse";
import { loadConfig } from "../src/config";
import { migrate } from "../src/migrate";
import { klineRow, type Kline } from "../src/candles/kline";
import { liveKeys } from "../src/live/protocol";
import { prop } from "../src/json";

import { SharedLimits } from "../src/api/limits";
const enabled = process.env.DATA_API_INTEGRATION === "1";
describe.skipIf(!enabled)("real WebSocket protocol and Valkey limits", () => {
  let redis: RedisClient, subscriber: RedisClient, stream: Stream, server: Server<StreamData>;
  const clients: WebSocket[] = [];
  const transports = new Map<string, ServerWebSocket<StreamData>>();
  const symbol = "BTCUSDT";
  const venue = `ws${Date.now()}`;
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const bar: Kline = { openTime: now, open: "10", high: "10", low: "10", close: "10", volume: "1", quoteVolume: "10", trades: 1, takerBuyVolume: "1", takerBuyQuoteVolume: "10" };
  beforeAll(async () => {
    const config = loadConfig({ ...process.env, CLICKHOUSE_DATABASE: "stream_test" });
    const ch = new ClickHouse(config.clickhouse);
    await ch.command("DROP DATABASE IF EXISTS stream_test", {}, "default");
    await migrate(ch, () => {});
    await ch.insert("klines_1m", [klineRow(venue, symbol, { ...bar, openTime: now - 60_000 })]);
    redis = new RedisClient(config.redisUrl); await redis.connect();
    subscriber = await redis.duplicate();
    await redis.hset(liveKeys(venue).recent(symbol), { [now]: JSON.stringify(bar) });
    const reader = new BarReader({ store: new CandleStore(ch), redis });
    stream = await createStream({ venues: [venue], reader, redis, subscriber, clientIpHeader: "x-test-ip", tickers: new Map(), market: id => id.startsWith(`${venue}:`) && (/^TEST\d+$/.test(id.split(":")[1]!) || id === `${venue}:BTCUSDT`) ? { id, venue, symbol, firstOpenTime: now - 60_000 } : undefined });
    server = Bun.serve<StreamData>({ port: 0, async fetch(request, bound) { if (await stream.upgrade(request, bound)) return; return new Response("upgrade required", { status: 426 }); }, websocket: { ...stream.websocket, open(ws) {
      transports.set(ws.data.ip, ws);
      stream.websocket.open?.(ws);
    } } });
    stream.attach(server);
  });
  afterAll(async () => {
    for (const client of clients) client.close();
    stream?.stop(); server?.stop(true); subscriber?.close(); redis?.close();
  });
  async function connect(ip: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { headers: { "x-test-ip": ip } });
    clients.push(ws);
    const messages: unknown[] = [];
    let notify: (() => void) | undefined;
    ws.onmessage = event => {
      if (typeof event.data !== "string") return;
      messages.push(JSON.parse(event.data)); notify?.();
    };
    const closed = new Promise<number>(resolve => { ws.onclose = event => resolve(event.code); });
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = reject; });
    return { ws, messages, closed, async next() {
      while (!messages.length) await new Promise<void>(resolve => { notify = resolve; });
      return messages.shift();
    } };
  }
  test("snapshot precedes changes, commands switch in order, and JSON ping responds", async () => {
    const client = await connect("192.0.2.1");
    const subscription = { type: "candle", market: `${venue}:BTCUSDT`, interval: "1m" };
    client.ws.send(JSON.stringify({ method: "subscribe", subscription }));
    expect(prop(await client.next(), "channel")).toBe("subscriptionResponse");
    const snapshot = prop(await client.next(), "data");
    expect(prop(snapshot, "isSnapshot")).toBe(true);
    expect(prop(snapshot, "seq")).toBe(1);
    expect(prop(prop(snapshot, "bar"), "c")).toBe("10");
    client.ws.send(JSON.stringify({ method: "unsubscribe", subscription }));
    client.ws.send(JSON.stringify({ method: "subscribe", subscription: { ...subscription, interval: "1h" } }));
    expect(prop(prop(await client.next(), "data"), "method")).toBe("unsubscribe");
    expect(prop(prop(await client.next(), "data"), "method")).toBe("subscribe");
    expect(prop(prop(await client.next(), "data"), "interval")).toBe("1h");
    client.ws.send('{"method":"ping"}');
    expect(prop(await client.next(), "channel")).toBe("pong");
    client.ws.close(); await client.closed;
  });
  test("connection admission sends error before 1013", async () => {
    const opened = [];
    for (let i = 0; i < 11; i++) opened.push(await connect("192.0.2.2"));
    const denied = opened[10]!;
    expect(prop(prop(await denied.next(), "data"), "code")).toBe("rate_limited");
    expect(await denied.closed).toBe(1013);
    for (const client of opened) client.ws.close();
  });
  test("per-connection abuse sends error before 1008", async () => {
    const client = await connect("192.0.2.3");
    for (let i = 0; i < 21; i++) client.ws.send('{"method":"ping"}');
    expect(await client.closed).toBe(1008);
    expect(client.messages.some(message => prop(prop(message, "data"), "code") === "rate_limited")).toBe(true);
  });
  test("oversized frames are rejected natively before application dispatch", async () => {
    const client = await connect("192.0.2.4");
    client.ws.send("x".repeat(4097));
    expect(await client.closed).toBe(1006); // Bun 1.4.3 drops the transport without a close frame.
  });
  test("new-connection and shared message budgets reject at their boundaries", async () => {
    const limits = new SharedLimits(redis);
    await limits.consume("ws:new:192.0.2.5", 30, 30, 60_000);
    const admission = await connect("192.0.2.5");
    expect(prop(prop(await admission.next(), "data"), "code")).toBe("rate_limited");
    expect(await admission.closed).toBe(1013);
    const messages = await connect("192.0.2.6");
    await limits.consume("ws:messages:192.0.2.6", 2000, 2000, 60_000);
    messages.ws.send('{"method":"ping"}');
    expect(prop(prop(await messages.next(), "data"), "code")).toBe("rate_limited");
    expect(await messages.closed).toBe(1008);
  });
  test("shared subscription leases reject the 1001st reservation", async () => {
    const limits = new SharedLimits(redis);
    const leases = [];
    try {
      for (let i = 0; i < 1000; i++) leases.push(await limits.acquire("ws:subscriptions:192.0.2.7", 1000, 90_000));
      const client = await connect("192.0.2.7");
      client.ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "ticker", market: `${venue}:BTCUSDT` } }));
      expect(prop(prop(await client.next(), "data"), "code")).toBe("too_many_subscriptions");
      expect(await client.closed).toBe(1008);
    } finally { await Promise.all(leases.map(lease => lease?.release())); }
  });
  test("per-connection subscription limit rejects the 201st subscription", async () => {
    const client = await connect("192.0.2.8");
    for (let i = 0; i < 200; i++) {
      client.ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "ticker", market: `${venue}:TEST${i}` } }));
      expect(prop(await client.next(), "channel")).toBe("subscriptionResponse");
      // Exercise the real platform clock: stay below 20 messages/s while filling subscriptions.
      await Bun.sleep(55);
    }
    client.ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "ticker", market: `${venue}:TEST200` } }));
    expect(prop(prop(await client.next(), "data"), "code")).toBe("too_many_subscriptions");
    expect(await client.closed).toBe(1008);
  }, 20_000);
  test("burst updates converge while fanout stays within four messages per second", async () => {
    const current = { ...bar, openTime: Math.floor(Date.now() / 60_000) * 60_000 };
    await redis.hset(liveKeys(venue).recent(symbol), { [current.openTime]: JSON.stringify(current) });
    const client = await connect("192.0.2.9");
    client.ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "candle", market: `${venue}:BTCUSDT`, interval: "1m" } }));
    await client.next();
    await client.next();
    const times: number[] = [];
    const sending = (async () => {
      for (let i = 0; i < 50; i++) {
        await redis.publish(liveKeys(venue).klines, JSON.stringify({ symbol, closed: false, kline: { ...current, close: String(100 + i) } }));
        // This integration test measures the real publisher timer, not simulated clock arithmetic.
        await Bun.sleep(25);
      }
    })();
    for (;;) {
      const message = await client.next();
      if (prop(message, "channel") !== "candle") continue;
      times.push(Date.now());
      if (prop(prop(prop(message, "data"), "bar"), "c") === "149") break;
    }
    await sending;
    for (const time of times) expect(times.filter(other => other > time - 1000 && other <= time).length).toBeLessThanOrEqual(4);
    client.ws.close(); await client.closed;
  }, 10_000);
  test("native backpressure closes a saturated egress transport", async () => {
    const client = await connect("192.0.2.10");
    const transport = transports.get("192.0.2.10")!;
    const chunk = Buffer.alloc(512 * 1024);
    let queued = false;
    // Saturate the actual socket synchronously, before the peer can drain its receive buffer.
    for (let i = 0; i < 128 && transport.readyState === 1; i++) {
      if (transport.send(chunk) < 0) queued = true;
    }
    expect(queued).toBe(true);
    expect(await client.closed).toBe(1006);
  });
});
