import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketStream } from "@/lib/market-data/stream";

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  constructor(readonly url: string) { FakeSocket.all.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(new Event("open")); }
  drop() { this.readyState = 3; this.onclose?.(new CloseEvent("close", { code: 1006 })); }
  receive(message: unknown) { this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) })); }
}

const candle = { type: "candle", market: "binance:NEARUSDC", interval: "1m" } as const;
const ack = (method: string, subscription: unknown = candle) => ({ channel: "subscriptionResponse", data: { method, subscription } });
const bar = (seq: number, t = 60_000 * seq) => ({ channel: "candle", data: { market: candle.market, interval: candle.interval, seq, isSnapshot: seq === 1, bar: { t, o: "1", h: "1", l: "1", c: "1", v: "1", q: "1", n: 1, x: false } } });
const create = () => new MarketStream("wss://data.test/v1/stream", { createSocket: url => new FakeSocket(url), idleMs: 1000, random: () => 0 });

beforeEach(() => { vi.useFakeTimers(); FakeSocket.all = []; });
afterEach(() => vi.useRealTimers());

describe("market stream", () => {
  it("shares one server subscription per key and closes the idle socket after the last listener leaves", () => {
    const stream = create();
    const first = stream.subscribe(candle, {});
    const second = stream.subscribe(candle, {});
    const socket = FakeSocket.all[0];
    socket.open();
    expect(socket.sent).toEqual([{ method: "subscribe", subscription: candle }]);
    first();
    expect(socket.sent).toHaveLength(1);
    second();
    expect(socket.sent.at(-1)).toEqual({ method: "unsubscribe", subscription: candle });
    vi.advanceTimersByTime(1000);
    expect(socket.readyState).toBe(3);
    expect(stream.getStatus()).toBe("idle");
  });

  it("delivers bars only after the subscribe acknowledgement and drops departed subscriptions", () => {
    const stream = create();
    const bars: number[] = [];
    const stop = stream.subscribe(candle, { candle: item => bars.push(item.t) });
    const socket = FakeSocket.all[0];
    socket.open();
    socket.receive(bar(7));
    socket.receive(ack("subscribe"));
    socket.receive(bar(1));
    socket.receive(bar(2));
    stop();
    socket.receive(bar(3));
    expect(bars).toEqual([60_000, 120_000]);
  });

  it("resubscribes and asks for a REST resync on a sequence gap, ignoring data until the new acknowledgement", () => {
    const stream = create();
    const bars: number[] = [];
    const resync = vi.fn();
    stream.subscribe(candle, { candle: item => bars.push(item.t), resync });
    const socket = FakeSocket.all[0];
    socket.open();
    socket.receive(ack("subscribe"));
    socket.receive(bar(1));
    socket.receive(bar(3));
    expect(resync).toHaveBeenCalledTimes(1);
    expect(socket.sent.slice(-2)).toEqual([{ method: "unsubscribe", subscription: candle }, { method: "subscribe", subscription: candle }]);
    socket.receive(bar(4));
    socket.receive(ack("unsubscribe"));
    socket.receive(ack("subscribe"));
    socket.receive(bar(1, 999));
    expect(bars).toEqual([60_000, 999]);
  });

  it("reconnects with backoff after a dropped connection, resubscribes and resyncs listeners", () => {
    const stream = create();
    const resync = vi.fn();
    const statuses: string[] = [];
    stream.onStatus(status => statuses.push(status));
    stream.subscribe(candle, { resync });
    FakeSocket.all[0].open();
    FakeSocket.all[0].drop();
    expect(stream.getStatus()).toBe("reconnecting");
    vi.advanceTimersByTime(499);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    const next = FakeSocket.all[1];
    next.open();
    expect(next.sent).toEqual([{ method: "subscribe", subscription: candle }]);
    expect(resync).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["connecting", "open", "reconnecting", "open"]);
  });

  it("sends a JSON ping every 30 seconds to survive 60-second proxy idle cuts", () => {
    const stream = create();
    stream.subscribe(candle, {});
    const socket = FakeSocket.all[0];
    socket.open();
    vi.advanceTimersByTime(60_000);
    expect(socket.sent.filter(message => JSON.stringify(message) === '{"method":"ping"}')).toHaveLength(2);
  });
  it("waits for every outstanding acknowledgement when a departed key is immediately rejoined", () => {
    const stream = create();
    const stop = stream.subscribe(candle, {});
    const socket = FakeSocket.all[0];socket.open();stop();
    const receive = vi.fn();stream.subscribe(candle, { candle: receive });
    socket.receive(ack("subscribe"));socket.receive(bar(1));expect(receive).not.toHaveBeenCalled();
    socket.receive(ack("unsubscribe"));socket.receive(ack("subscribe"));socket.receive(bar(1));
    expect(receive).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);expect(socket.readyState).toBe(1);
  });

  it("ignores messages and close callbacks from the replaced socket", () => {
    const stream = create(), receive = vi.fn(), resync = vi.fn();
    stream.subscribe(candle, { candle: receive, resync });
    const previous = FakeSocket.all[0];previous.open();previous.drop();vi.advanceTimersByTime(500);
    const current = FakeSocket.all[1];current.open();current.receive(ack("subscribe"));
    previous.receive(ack("subscribe"));previous.receive(bar(1));previous.drop();
    expect(stream.getStatus()).toBe("open");expect(receive).not.toHaveBeenCalled();
    current.receive(bar(1));expect(receive).toHaveBeenCalledTimes(1);expect(resync).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);expect(FakeSocket.all).toHaveLength(2);
  });

  it("stops reconnecting and pinging after the last subscription leaves", () => {
    const stream = create(), stop = stream.subscribe(candle, {});
    const socket = FakeSocket.all[0];socket.open();socket.drop();stop();
    vi.advanceTimersByTime(60_000);
    expect(stream.getStatus()).toBe("idle");
    expect(FakeSocket.all.every(item => item.readyState === 3)).toBe(true);
    expect(FakeSocket.all.flatMap(item => item.sent).filter(item => JSON.stringify(item) === '{"method":"ping"}')).toHaveLength(0);
  });

  it("routes subscription errors only to listeners for the affected market", () => {
    const stream = create(), first = vi.fn(), second = vi.fn();
    stream.subscribe(candle, { error: first });
    stream.subscribe({ ...candle, market: "binance:BTCUSDC" }, { error: second });
    const socket = FakeSocket.all[0];socket.open();
    socket.receive({ channel: "error", data: { code: "unavailable", subscription: candle } });
    expect(first).toHaveBeenCalledExactlyOnceWith("unavailable");expect(second).not.toHaveBeenCalled();
  });

});
