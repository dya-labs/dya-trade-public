import { prop } from "../json";
import { log } from "../log";
import { priceDecimal, volumeDecimal } from "../candles/kline";
import type { Ticker } from "../live/protocol";

// Binance closes connections at 24h; reconnect earlier on our own schedule.
const MAX_AGE_MS = 23 * 60 * 60_000;
// Mini tickers provide regular activity even when aggregate trades are quiet.
const IDLE_MS = 30_000;

export type StreamHandlers = {
  onEvent(stream: string, data: unknown): void;
  onConnected(connected: boolean): void;
  log?: (message: string, details?: object) => void;
};

/**
 * Combined market stream (`/stream?streams=a/b/...`, ≤1024 streams per connection) with
 * reconnect, capped exponential backoff (well under 300 connects per 5 minutes per IP),
 * idle detection, proactive rotation, and `serverShutdown` handling. Pings are answered by
 * the runtime's WebSocket implementation.
 */
export function openStream(baseUrl: string, streams: readonly string[], handlers: StreamHandlers): { close(): void } {
  if (!streams.length || streams.length > 1024) throw new Error("A Binance connection carries 1-1024 streams");
  const emit = handlers.log ?? log;
  const url = `${baseUrl}/stream?streams=${streams.join("/")}`;
  let socket: WebSocket | undefined;
  let retiring: WebSocket | undefined;
  let stopped = false;
  let backoff = 1000;
  let watchdog: Timer | undefined;
  let retry: Timer | undefined;

  const connect = () => {
    const ws = new WebSocket(url);
    socket = ws;
    const opened = Date.now();
    let lastMessage = opened;
    const recycle = (reason: string) => {
      if (socket !== ws) return;
      emit("binance.stream.recycle", { reason });
      if (reason === "max-age") {
        clearInterval(watchdog);
        retiring = ws;
        connect();
      } else ws.close();
    };
    watchdog = setInterval(() => {
      if (Date.now() - lastMessage > IDLE_MS) recycle("idle");
      else if (Date.now() - opened > MAX_AGE_MS) recycle("max-age");
    }, 5000);
    ws.onopen = () => {
      emit("binance.stream.open", { streams: streams.length });
      retiring?.close();
      retiring = undefined;
      handlers.onConnected(true);
    };
    ws.onmessage = event => {
      lastMessage = Date.now();
      backoff = 1000;
      let message: unknown;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      const stream = prop(message, "stream"), data = prop(message, "data");
      if (prop(data, "e") === "serverShutdown") return recycle("server-shutdown");
      if (typeof stream === "string") handlers.onEvent(stream, data);
    };
    ws.onclose = event => {
      if (socket !== ws) return;
      clearInterval(watchdog);
      socket = undefined;
      handlers.onConnected(false);
      if (stopped) return;
      emit("binance.stream.closed", { code: event.code, retryInMs: backoff });
      retry = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60_000);
    };
    ws.onerror = () => emit("binance.stream.error");
  };

  connect();
  return {
    close() {
      stopped = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      socket?.close();
      retiring?.close();
    },
  };
}

/** `<symbol>@miniTicker` payload. */
export function parseMiniTicker(data: unknown): Ticker {
  const symbol = prop(data, "s"), eventTime = prop(data, "E");
  if (prop(data, "e") !== "24hrMiniTicker" || typeof symbol !== "string" || typeof eventTime !== "number") throw new Error("Invalid mini ticker");
  const lastPrice = priceDecimal(prop(data, "c")), openPrice = priceDecimal(prop(data, "o"));
  const open = Number(openPrice);
  return {
    symbol, lastPrice, openPrice, highPrice: priceDecimal(prop(data, "h")), lowPrice: priceDecimal(prop(data, "l")),
    volume: volumeDecimal(prop(data, "v")), quoteVolume: volumeDecimal(prop(data, "q")), eventTime,
    changePercent: open > 0 ? Math.round(((Number(lastPrice) - open) / open) * 1e6) / 1e4 : 0,
  };
}
