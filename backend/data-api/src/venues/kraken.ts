import type { CandlePage, Instrument, LiveSink, Trade, Venue, VenueOptions, VenueRest } from "./types";
import type { HttpOptions } from "./http";
import type { Kline, Resolution } from "../candles/kline";
import { VenueHttp, VenueUnavailable } from "./http";
import { openSocket } from "./socket";
import { MINUTE, RESOLUTION_MS, kline, numberDecimal, priceDecimal, volumeDecimal } from "../candles/kline";
import { prop } from "../json";

type Decimal = { n: bigint; scale: number };
const zero = (): Decimal => ({ n: 0n, scale: 0 });
const displayAsset: Record<string, string> = { XBT: "BTC", XDG: "DOGE" };
const restAsset: Record<string, string> = { BTC: "XBT", DOGE: "XDG" };
function dec(value: string): Decimal {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Invalid Kraken decimal");
  const [whole = "", fraction = ""] = value.split(".");
  return { n: BigInt(whole + fraction), scale: fraction.length };
}
function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return { n: a.n * 10n ** BigInt(scale - a.scale) + b.n * 10n ** BigInt(scale - b.scale), scale };
}
function mul(a: Decimal, b: Decimal): Decimal { return { n: a.n * b.n, scale: a.scale + b.scale }; }
function text(a: Decimal): string {
  if (a.n < 0n) throw new Error("Negative Kraken decimal");
  const s = a.n.toString().padStart(a.scale + 1, "0");
  return a.scale ? `${s.slice(0, -a.scale)}.${s.slice(-a.scale)}` : s;
}
function plain(value: unknown): string { return typeof value === "number" ? numberDecimal(value) : priceDecimal(value); }
function seconds(value: unknown): number {
  const s = typeof value === "number" ? numberDecimal(value) : value;
  if (typeof s !== "string" || !/^\d+(?:\.\d+)?$/.test(s)) throw new Error("Invalid Kraken timestamp");
  const [whole = "", fraction = ""] = s.split(".");
  const result = Number(BigInt(whole) * 1000n + BigInt((fraction + "000").slice(0, 3)));
  if (!Number.isSafeInteger(result)) throw new Error("Invalid Kraken timestamp");
  return result;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Kraken object");
  return value as Record<string, unknown>;
}
function rows(result: Record<string, unknown>): unknown[] {
  const keys = Object.keys(result).filter(key => key !== "last");
  const value = keys.length === 1 ? result[keys[0]!] : undefined;
  if (!Array.isArray(value)) throw new Error("Invalid Kraken rows");
  return value;
}
type RestTrade = Trade & { rawQuantity: string };
function restTrade(row: unknown): RestTrade {
  if (!Array.isArray(row) || row.length < 6 || (row[3] !== "b" && row[3] !== "s") || typeof row[1] !== "string") throw new Error("Invalid Kraken trade");
  dec(row[1]);
  return { time: seconds(row[2]), price: priceDecimal(row[0]), quantity: volumeDecimal(row[1]), rawQuantity: row[1], count: 1, takerBuy: row[3] === "b" };
}
class MinuteBar {
  readonly bar: Kline;
  private volume = zero(); private quote = zero(); private buy = zero(); private buyQuote = zero();
  constructor(trade: RestTrade) {
    this.bar = { openTime: Math.floor(trade.time / MINUTE) * MINUTE, open: trade.price, high: trade.price, low: trade.price, close: trade.price, volume: "0", quoteVolume: "0", trades: 0, takerBuyVolume: "0", takerBuyQuoteVolume: "0" };
    this.add(trade);
  }
  add(trade: RestTrade): void {
    const p = dec(trade.price), q = dec(trade.rawQuantity), quote = mul(p, q);
    if (add(p, { ...dec(this.bar.high), n: -dec(this.bar.high).n }).n > 0n) this.bar.high = trade.price;
    if (add(p, { ...dec(this.bar.low), n: -dec(this.bar.low).n }).n < 0n) this.bar.low = trade.price;
    this.bar.close = trade.price; this.bar.trades++;
    this.volume = add(this.volume, q); this.quote = add(this.quote, quote);
    if (trade.takerBuy) { this.buy = add(this.buy, q); this.buyQuote = add(this.buyQuote, quote); }
  }
  snapshot(): Kline {
    return kline({ ...this.bar, volume: text(this.volume), quoteVolume: text(this.quote), takerBuyVolume: text(this.buy), takerBuyQuoteVolume: text(this.buyQuote) });
  }
}

type Dependencies = Pick<HttpOptions, "fetcher" | "now" | "sleep">;
export function createKrakenRest(options: VenueOptions, deps: Dependencies = {}): VenueRest {
  const http = new VenueHttp({ venue: "kraken", url: options.restUrl, budget: options.budget, ...deps });
  const now = deps.now ?? Date.now, sleep = deps.sleep ?? Bun.sleep;
  let pausedUntil = 0;
  async function get(path: string): Promise<Record<string, unknown>> {
    if (pausedUntil > now()) await sleep(pausedUntil - now());
    const data = await http.get(`/0/public/${path}`), errors = prop(data, "error");
    if (!Array.isArray(errors) || errors.some(error => typeof error !== "string")) throw new Error("Invalid Kraken error envelope");
    if (errors.length) {
      if (errors.some(error => String(error).includes("Rate limit") || String(error).includes("Throttled"))) {
        pausedUntil = now() + 60_000;
        throw new VenueUnavailable(`Kraken: ${errors.join(", ")}`, 429, pausedUntil);
      }
      throw new Error(`Kraken: ${errors.join(", ")}`);
    }
    return record(prop(data, "result"));
  }
  async function trades(symbol: string, since: string, count = 1000) {
    const data = await get(`Trades?pair=${encodeURIComponent(symbol)}&since=${since}&count=${count}`);
    const last = data.last;
    if (typeof last !== "string" || !/^\d+$/.test(last)) throw new Error("Invalid Kraken cursor");
    return { trades: rows(data).map(restTrade), last };
  }
  async function nativeCandles(symbol: string, interval: string, from: number, to: number): Promise<Kline[]> {
    if (interval !== "1m" && interval !== "1h" && interval !== "1d") throw new Error("Unsupported Kraken interval");
    const ms = RESOLUTION_MS[interval];
    const result = await get(`OHLC?pair=${encodeURIComponent(symbol)}&interval=${ms / MINUTE}&since=${Math.floor(from / 1000)}`);
    // Kraken always appends the current, uncommitted candle, regardless of since.
    return rows(result).slice(0, -1).map(row => {
      if (!Array.isArray(row) || row.length !== 8) throw new Error("Invalid Kraken OHLC row");
      const volume = plain(row[6]), vwap = plain(row[5]);
      // Native OHLC omits turnover: rounded VWAP × volume is approximate, for parity reporting only.
      // The synced trade-built candles below retain exact quote sums and taker-buy fields.
      return kline({ openTime: seconds(row[0]), open: plain(row[1]), high: plain(row[2]), low: plain(row[3]), close: plain(row[4]), volume, quoteVolume: text(mul(dec(volume), dec(vwap))), trades: row[7], takerBuyVolume: "0", takerBuyQuoteVolume: "0" }, interval);
    }).filter(row => row.openTime >= from && row.openTime < to).sort((a, b) => a.openTime - b.openTime);
  }
  return {
    async instruments(): Promise<Instrument[]> {
      const result = await get("AssetPairs");
      const instruments: Instrument[] = [];
      for (const value of Object.values(result)) {
        const symbol = prop(value, "altname"), ws = prop(value, "wsname"), status = prop(value, "status");
        if (typeof symbol !== "string" || !/^[A-Za-z0-9_-]{2,30}$/.test(symbol) || typeof status !== "string") throw new Error("Invalid Kraken instrument");
        if (typeof ws !== "string") continue; // Dark-pool/non-WS instruments are not public spot markets.
        const [base, quote, extra] = ws.split("/");
        if (!base || !quote || extra) throw new Error("Invalid Kraken pair name");
        instruments.push({ symbol, base: displayAsset[base] ?? base, quote: displayAsset[quote] ?? quote, status: status === "online" ? "TRADING" : status });
      }
      return instruments;
    },
    async earliest(symbol: string, resolution: Resolution): Promise<number | null> {
      const first = (await trades(symbol, "0", 1)).trades[0];
      return first ? Math.floor(first.time / RESOLUTION_MS[resolution]) * RESOLUTION_MS[resolution] : null;
    },
    async candles(symbol: string, resolution: Resolution, from: number, to: number): Promise<CandlePage> {
      if (resolution !== "1m" || from >= to) throw new Error("Invalid Kraken candle range");
      // since is exclusive in nanoseconds; include a trade exactly on the requested minute boundary.
      let cursor = (from > 0 ? BigInt(from) * 1_000_000n - 1n : 0n).toString();
      const bars = new Map<number, MinuteBar>();
      for (;;) {
        const page = await trades(symbol, cursor);
        let lastTime = from;
        for (const trade of page.trades) {
          lastTime = Math.max(lastTime, trade.time);
          if (trade.time < from || trade.time >= to) continue;
          const minute = Math.floor(trade.time / MINUTE) * MINUTE, bar = bars.get(minute);
          if (bar) bar.add(trade); else bars.set(minute, new MinuteBar(trade));
        }
        const boundary = Math.floor(lastTime / MINUTE) * MINUTE;
        const coveredTo = page.trades.length < 1000 || lastTime >= to ? to : Math.min(to, boundary);
        if (coveredTo > from) return { coveredTo, klines: [...bars.values()].filter(bar => bar.bar.openTime >= from && bar.bar.openTime < coveredTo).map(bar => bar.snapshot()).sort((a, b) => a.openTime - b.openTime) };
        if (BigInt(page.last) <= BigInt(cursor)) throw new Error("Kraken trade cursor did not advance");
        cursor = page.last;
      }
    },
    nativeCandles,
  };
}

/** Parses only live trades: subscription snapshots would replay already folded trades. */
export function parseKrakenFrame(data: unknown, symbols: ReadonlyMap<string, string>, sink: LiveSink, now = Date.now): void {
  try {
    if (prop(data, "success") === false) throw new Error(`Kraken subscription: ${String(prop(data, "error"))}`);
    const channel = prop(data, "channel");
    if (channel !== "trade" && channel !== "ticker") return;
    const type = prop(data, "type");
    if (type !== "snapshot" && type !== "update") throw new Error("Invalid Kraken frame type");
    if (channel === "trade" && type === "snapshot") return;
    const values = prop(data, "data");
    if (!Array.isArray(values)) throw new Error("Invalid Kraken frame rows");
    for (const row of values) {
      const ws = prop(row, "symbol"), symbol = typeof ws === "string" ? symbols.get(ws) : undefined;
      if (!symbol) throw new Error("Unknown Kraken WS symbol");
      if (channel === "trade") {
        const stamp = prop(row, "timestamp"), side = prop(row, "side"), id = prop(row, "trade_id");
        const time = typeof stamp === "string" ? Date.parse(stamp) : NaN;
        if (!Number.isSafeInteger(time) || time < 0 || (side !== "buy" && side !== "sell") || typeof id !== "number" || !Number.isSafeInteger(id)) throw new Error("Invalid Kraken live trade");
        sink.trade(symbol, { time, price: priceDecimal(numberDecimal(prop(row, "price"))), quantity: volumeDecimal(numberDecimal(prop(row, "qty"))), count: 1, takerBuy: side === "buy" });
      } else {
        const lastPrice = priceDecimal(numberDecimal(prop(row, "last"))), change = prop(row, "change");
        if (typeof change !== "number" || !Number.isFinite(change)) throw new Error("Invalid Kraken ticker change");
        const delta = dec(numberDecimal(Math.abs(change)));
        const openPrice = priceDecimal(text(add(dec(lastPrice), { ...delta, n: change < 0 ? delta.n : -delta.n })));
        const rawVolume = numberDecimal(prop(row, "volume")), vwap = numberDecimal(prop(row, "vwap"));
        const open = Number(openPrice);
        // Kraken omits quote turnover: derive it from the published 24h volume × VWAP.
        sink.ticker({ symbol, lastPrice, openPrice, highPrice: priceDecimal(numberDecimal(prop(row, "high"))), lowPrice: priceDecimal(numberDecimal(prop(row, "low"))), volume: volumeDecimal(rawVolume), quoteVolume: volumeDecimal(text(mul(dec(rawVolume), dec(vwap)))), changePercent: open ? Math.round((Number(lastPrice) - open) / open * 1e6) / 1e4 : 0, eventTime: now() });
      }
    }
  } catch (error) { sink.invalid(String(error)); }
}

export const kraken: Venue = {
  id: "kraken", label: "Kraken", coinGeckoId: "kraken", history: ["1m"], fields: { quoteVolume: true, trades: true, takerBuy: true },
  // Kraken's native weeks start Thursday, not our Monday grid.
  parityIntervals: ["1m", "1h", "1d"],
  // Public Trades/OHLC are limited per IP/pair; Kraken recommends <=1 request/second.
  // https://support.kraken.com/articles/206548367-what-are-the-api-rate-limits-
  defaults: { restUrl: "https://api.kraken.com", streamUrl: "wss://ws.kraken.com/v2", budget: 30 },
  symbol: (base, quote) => `${restAsset[base] ?? base}${restAsset[quote] ?? quote}`,
  rest: options => createKrakenRest(options),
  live: (options, rest) => ({
    open(symbols, sink) {
      let stopped = false;
      const sockets: { close(): void }[] = [];
      let retry: Timer | undefined;
      let backoff = 1000;
      // Instrument discovery is a live prerequisite too: transient REST failures must not
      // leave an otherwise unchanged subscription set permanently disconnected.
      const connect = () => { void rest.instruments().then(instruments => {
        if (stopped) return;
        const mapping = new Map<string, string>();
        for (const symbol of symbols) {
          const instrument = instruments.find(row => row.symbol === symbol);
          if (!instrument) throw new Error(`Unknown Kraken instrument ${symbol}`);
          mapping.set(`${instrument.base}/${instrument.quote}`, symbol);
        }
        const names = [...mapping.keys()], connected = new Set<number>();
        const count = Math.ceil(names.length / 50);
        for (let index = 0; index < count; index++) {
          const batch = names.slice(index * 50, (index + 1) * 50);
          sockets.push(openSocket({ venue: "kraken", url: () => options.streamUrl,
            onOpen(send) { for (const channel of ["trade", "ticker"]) send(JSON.stringify({ method: "subscribe", params: { channel, symbol: batch, snapshot: channel === "ticker" } })); },
            onMessage(raw) { try { parseKrakenFrame(JSON.parse(raw), mapping, sink); } catch (error) { sink.invalid(String(error)); } },
            onConnected(value) { if (value) connected.add(index); else connected.delete(index); sink.connected(connected.size === count); },
            ping: { message: '{"method":"ping"}', everyMs: 20_000 },
          }));
        }
      }).catch(error => {
        if (stopped) return;
        sink.invalid(String(error));
        sink.connected(false);
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 60_000);
      }); };
      connect();
      return { close() { stopped = true; clearTimeout(retry); for (const socket of sockets) socket.close(); } };
    },
  }),
};
