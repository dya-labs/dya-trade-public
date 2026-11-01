import { decimal, units, volumeUnits } from "../candles/bar";
import { MINUTE, type Kline } from "../candles/kline";
import type { KlineEvent } from "../live/protocol";
import { log } from "../log";
import type { Trade } from "../venues/types";

export type MinuteFields = { quoteVolume: boolean; trades: boolean; takerBuy: boolean };

/** Exact fixed-point fold of one minute's trades; quote precision is kept until the snapshot. */
export class TradeBar {
  readonly openTime: number;
  private readonly open: bigint;
  private high: bigint;
  private low: bigint;
  private close: bigint;
  private volume = 0n;
  private quote = 0n;
  private buy = 0n;
  private buyQuote = 0n;
  private trades = 0;

  constructor(trade: Trade, private readonly fields: MinuteFields) {
    this.openTime = Math.floor(trade.time / MINUTE) * MINUTE;
    this.open = this.high = this.low = this.close = units(trade.price);
    this.add(trade);
  }

  add(trade: Trade): void {
    if (Math.floor(trade.time / MINUTE) * MINUTE !== this.openTime) throw new Error("Trade outside minute");
    const price = units(trade.price), quantity = units(trade.quantity), quote = price * quantity;
    this.high = price > this.high ? price : this.high;
    this.low = price < this.low ? price : this.low;
    this.close = price;
    this.volume += quantity;
    this.quote += quote;
    this.trades += trade.count;
    if (trade.takerBuy) { this.buy += quantity; this.buyQuote += quote; }
  }

  /** Quote volumes, trade counts and taker volumes are zeroed when the venue's REST candles lack them, so live and settled minutes agree. */
  snapshot(): Kline {
    const quote = (value: bigint) => decimal(volumeUnits(value / 10n ** 18n));
    return {
      openTime: this.openTime, open: decimal(this.open), high: decimal(this.high), low: decimal(this.low), close: decimal(this.close),
      volume: decimal(this.volume), quoteVolume: this.fields.quoteVolume ? quote(this.quote) : "0",
      trades: this.fields.trades ? this.trades : 0,
      takerBuyVolume: this.fields.takerBuy ? decimal(this.buy) : "0",
      takerBuyQuoteVolume: this.fields.takerBuy ? quote(this.buyQuote) : "0",
    };
  }
}

type State = { bar: TradeBar | undefined; publishedAt: number; timer: Timer | undefined; dirty: boolean };

/**
 * Folds ordered trades into the open 1m bar per symbol and publishes it: immediately when the
 * symbol was quiet for 250 ms, otherwise at most every 250 ms with the latest state; a minute
 * rollover publishes the closed bar at once. Ordering and de-duplication are the caller's.
 */
export class MinuteFolder {
  private readonly states = new Map<string, State>();
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly fields: MinuteFields, private readonly publish: (event: KlineEvent) => Promise<void>) {}

  apply(symbol: string, trade: Trade): void {
    let state = this.states.get(symbol);
    if (!state) {
      state = { bar: undefined, publishedAt: 0, timer: undefined, dirty: false };
      this.states.set(symbol, state);
    }
    const minute = Math.floor(trade.time / MINUTE) * MINUTE;
    // A late trade for an already published minute is left to the REST-settled correction.
    if (state.bar && minute < state.bar.openTime) return;
    const rollover = state.bar !== undefined && state.bar.openTime !== minute;
    if (rollover) this.flush(symbol, state, true);
    if (!state.bar || rollover) state.bar = new TradeBar(trade, this.fields);
    else state.bar.add(trade);
    state.dirty = true;
    const current = state;
    const delay = Math.max(0, state.publishedAt + 250 - Date.now());
    if (rollover || delay === 0) this.flush(symbol, state, false);
    else if (!state.timer) state.timer = setTimeout(() => this.flush(symbol, current, false), delay);
  }

  private flush(symbol: string, state: State, closed: boolean): void {
    clearTimeout(state.timer);
    state.timer = undefined;
    if (!state.bar || (!state.dirty && !closed)) return;
    const event: KlineEvent = { symbol, closed, kline: state.bar.snapshot() };
    state.dirty = false;
    state.publishedAt = Date.now();
    this.writes = this.writes.then(() => this.publish(event)).catch(error => log("ingest.publish.failed", { error: String(error) }, "error"));
  }

  async stop(): Promise<void> {
    for (const state of this.states.values()) clearTimeout(state.timer);
    await this.writes;
  }
}
