import { z } from "zod";
import { tickerSchema, type Ticker } from "./api";

export type StreamSubscription = { type: "candle"; market: string; interval: string } | { type: "ticker"; market: string };
export type StreamBar = { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean };
export type StreamListener = {
  candle?(bar: StreamBar, snapshot: boolean): void;
  ticker?(ticker: Ticker, snapshot: boolean): void;
  /** The stream reconnected or skipped a message: refetch REST state; live updates continue. */
  resync?(): void;
  error?(code: string): void;
};
export type StreamStatus = "idle" | "connecting" | "open" | "reconnecting";

const decimal = z.string();
const subscriptionSchema = z.object({ type: z.enum(["candle", "ticker"]), market: z.string(), interval: z.string().optional() });
const messageSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("subscriptionResponse"), data: z.object({ method: z.string(), subscription: subscriptionSchema }) }),
  z.object({ channel: z.literal("candle"), data: z.object({ market: z.string(), interval: z.string(), seq: z.number(), isSnapshot: z.boolean(),
    bar: z.object({ t: z.number(), o: decimal, h: decimal, l: decimal, c: decimal, v: decimal, x: z.boolean() }) }) }),
  z.object({ channel: z.literal("ticker"), data: z.object({ market: z.string(), seq: z.number(), isSnapshot: z.boolean(), ticker: tickerSchema }) }),
  z.object({ channel: z.literal("error"), data: z.object({ code: z.string(), subscription: subscriptionSchema.partial().optional() }) }),
  z.object({ channel: z.literal("pong") }),
]);

const keyOf = (subscription: { type?: string; market?: string; interval?: string }) =>
  subscription.type === "candle" ? `candle:${subscription.market}:${subscription.interval}` : `ticker:${subscription.market}`;

type Entry = { subscription: StreamSubscription; listeners: Set<StreamListener>; seq: number };
type Socket = Pick<WebSocket, "readyState" | "send" | "close"> & {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
};
export type StreamOptions = {
  createSocket?: (url: string) => Socket;
  /** Close the socket this long after the last subscription ends; interval switches reuse it. */
  idleMs?: number;
  random?: () => number;
};

const PING_MS = 30_000;
const OPEN = 1;

/**
 * One WebSocket per tab with reference-counted subscriptions. Every hop to the data API has a
 * 60 s idle cut, so a JSON ping goes out every 30 s. Data for a subscription is accepted only
 * after its latest subscribe acknowledgement and with consecutive `seq`; anything else is
 * dropped, and a gap resubscribes and asks listeners to resync from REST.
 */
export class MarketStream {
  private socket: Socket | undefined;
  private readonly entries = new Map<string, Entry>();
  /** Subscribe commands sent on the current socket and not yet acknowledged, per key. */
  private readonly outstanding = new Map<string, number>();
  private readonly statusListeners = new Set<(status: StreamStatus) => void>();
  private status: StreamStatus = "idle";
  private attempts = 0;
  private everOpened = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly url: string, private readonly options: StreamOptions = {}) {
    if (typeof window !== "undefined") window.addEventListener("online", () => { if (this.status === "reconnecting") this.reconnectNow(); });
  }

  getStatus() { return this.status; }

  onStatus(listener: (status: StreamStatus) => void) {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  subscribe(subscription: StreamSubscription, listener: StreamListener) {
    const key = keyOf(subscription);
    clearTimeout(this.idleTimer);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { subscription, listeners: new Set(), seq: 0 };
      this.entries.set(key, entry);
      this.sendSubscribe(key, subscription);
    }
    entry.listeners.add(listener);
    if (!this.socket && this.status !== "reconnecting") this.connect();
    return () => this.release(key, listener);
  }

  private release(key: string, listener: StreamListener) {
    const entry = this.entries.get(key);
    if (!entry?.listeners.delete(listener) || entry.listeners.size) return;
    this.entries.delete(key);
    this.send({ method: "unsubscribe", subscription: entry.subscription });
    if (!this.entries.size) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => { if (!this.entries.size) this.shutdown(); }, this.options.idleMs ?? 15_000);
    }
  }

  private setStatus(status: StreamStatus) {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private send(message: unknown) {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }

  private sendSubscribe(key: string, subscription: StreamSubscription) {
    if (this.socket?.readyState !== OPEN) return;
    this.outstanding.set(key, (this.outstanding.get(key) ?? 0) + 1);
    this.send({ method: "subscribe", subscription });
  }

  private connect() {
    clearTimeout(this.reconnectTimer);
    this.setStatus(this.everOpened ? "reconnecting" : "connecting");
    const socket = this.options.createSocket?.(this.url) ?? new WebSocket(this.url);
    this.socket = socket;
    this.outstanding.clear();
    socket.onopen = () => {
      if (this.socket !== socket) return;
      const reopened = this.everOpened;
      this.everOpened = true;
      this.attempts = 0;
      this.setStatus("open");
      for (const [key, entry] of this.entries) { entry.seq = 0; this.sendSubscribe(key, entry.subscription); }
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ method: "ping" }), PING_MS);
      if (reopened) for (const entry of this.entries.values()) for (const listener of entry.listeners) listener.resync?.();
    };
    socket.onmessage = event => { if (this.socket === socket) this.receive(event.data); };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      clearInterval(this.pingTimer);
      if (!this.entries.size) { this.setStatus("idle"); return; }
      this.setStatus("reconnecting");
      const delay = Math.min(30_000, 1000 * 2 ** this.attempts++) * (0.5 + (this.options.random ?? Math.random)() / 2);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  private reconnectNow() {
    clearTimeout(this.reconnectTimer);
    if (!this.socket && this.entries.size) this.connect();
  }

  private shutdown() {
    const socket = this.socket;
    this.socket = undefined;
    clearInterval(this.pingTimer);
    clearTimeout(this.reconnectTimer);
    this.everOpened = false;
    this.setStatus("idle");
    socket?.close(1000, "idle");
  }

  private receive(raw: unknown) {
    let parsed;
    try { parsed = messageSchema.safeParse(JSON.parse(String(raw))); } catch { return; }
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.channel === "pong") return;
    if (message.channel === "subscriptionResponse") {
      if (message.data.method !== "subscribe") return;
      const key = keyOf(message.data.subscription);
      const pending = (this.outstanding.get(key) ?? 0) - 1;
      if (pending > 0) this.outstanding.set(key, pending);
      else {
        this.outstanding.delete(key);
        const entry = this.entries.get(key);
        if (entry) entry.seq = 0;
      }
      return;
    }
    if (message.channel === "error") {
      const entry = message.data.subscription?.type ? this.entries.get(keyOf(message.data.subscription)) : undefined;
      for (const listener of entry?.listeners ?? []) listener.error?.(message.data.code);
      return;
    }
    const key = message.channel === "candle" ? `candle:${message.data.market}:${message.data.interval}` : `ticker:${message.data.market}`;
    const entry = this.entries.get(key);
    // Unknown keys are departed subscriptions; outstanding acks mean the data predates the latest subscribe.
    if (!entry || this.outstanding.has(key)) return;
    if (message.data.seq !== entry.seq + 1) {
      this.send({ method: "unsubscribe", subscription: entry.subscription });
      this.sendSubscribe(key, entry.subscription);
      for (const listener of entry.listeners) listener.resync?.();
      return;
    }
    entry.seq = message.data.seq;
    for (const listener of entry.listeners) {
      if (message.channel === "candle") listener.candle?.(message.data.bar, message.data.isSnapshot);
      else listener.ticker?.(message.data.ticker, message.data.isSnapshot);
    }
  }
}
