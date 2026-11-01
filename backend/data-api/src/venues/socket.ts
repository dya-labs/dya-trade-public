import { log } from "../log";

export type SocketOptions = {
  venue: string;
  /** Resolved per connection (some venues issue a short-lived URL or token). */
  url: () => string | Promise<string>;
  /** Sends subscriptions after each (re)connect. */
  onOpen(send: (message: string) => void): void;
  /** Text frames; binary frames too (decoded as UTF-8) unless `onBinary` is set. */
  onMessage(text: string, send: (message: string) => void): void;
  /** Binary frames, for venues that push protobuf. */
  onBinary?(data: Uint8Array, send: (message: string) => void): void;
  onConnected(connected: boolean): void;
  /** Application-level keepalive the venue requires, sent every `pingMs`. */
  ping?: { message: string; everyMs: number };
  /** Reconnect when no frame arrived for this long (tickers keep quiet symbols active). */
  idleMs?: number;
  /** Proactively replace the connection before the venue's forced disconnect. */
  maxAgeMs?: number;
  /** Handshake headers, for venues whose WAF rejects the runtime's default User-Agent. */
  headers?: Record<string, string>;
};

/**
 * Reconnecting WebSocket shared by venue adapters: capped exponential backoff, idle watchdog,
 * venue keepalive, and overlap rotation (the replacement opens before the old one closes).
 */
export function openSocket(options: SocketOptions): { close(): void } {
  const idleMs = options.idleMs ?? 60_000;
  let socket: WebSocket | undefined;
  let stopped = false;
  let backoff = 1000;
  let retry: Timer | undefined;

  const connect = async () => {
    let url: string;
    try { url = await options.url(); } catch (error) {
      log(`${options.venue}.stream.url`, { error: String(error) }, "error");
      return schedule();
    }
    if (stopped) return;
    const ws = options.headers ? new WebSocket(url, { headers: options.headers }) : new WebSocket(url);
    ws.binaryType = "arraybuffer";
    socket = ws;
    const opened = Date.now();
    let lastMessage = opened;
    const send = (message: string) => { if (ws.readyState === WebSocket.OPEN) ws.send(message); };
    const timers: Timer[] = [];
    const retire = () => { for (const timer of timers) clearInterval(timer); };
    timers.push(setInterval(() => {
      if (socket !== ws) return;
      if (Date.now() - lastMessage > idleMs) { log(`${options.venue}.stream.recycle`, { reason: "idle" }); ws.close(); }
      else if (options.maxAgeMs && Date.now() - opened > options.maxAgeMs) {
        log(`${options.venue}.stream.recycle`, { reason: "max-age" });
        retire();
        socket = undefined;
        void connect().finally(() => setTimeout(() => ws.close(), 5000));
      }
    }, 5000));
    if (options.ping) timers.push(setInterval(() => send(options.ping!.message), options.ping.everyMs));
    ws.onopen = () => {
      log(`${options.venue}.stream.open`);
      options.onOpen(send);
      options.onConnected(true);
    };
    ws.onmessage = event => {
      // A retiring connection's frames would duplicate trades already arriving on its replacement.
      if (socket !== ws) return;
      lastMessage = Date.now();
      backoff = 1000;
      if (typeof event.data === "string") options.onMessage(event.data, send);
      else if (options.onBinary) options.onBinary(new Uint8Array(event.data as ArrayBuffer), send);
      else options.onMessage(new TextDecoder().decode(event.data as ArrayBuffer), send);
    };
    ws.onclose = event => {
      retire();
      if (socket !== ws) return;
      socket = undefined;
      options.onConnected(false);
      if (stopped) return;
      log(`${options.venue}.stream.closed`, { code: event.code, retryInMs: backoff });
      schedule();
    };
    ws.onerror = () => log(`${options.venue}.stream.error`, {}, "warn");
  };

  const schedule = () => {
    if (stopped) return;
    retry = setTimeout(() => void connect(), backoff);
    backoff = Math.min(backoff * 2, 60_000);
  };

  void connect();
  return {
    close() {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    },
  };
}
