import { prop } from "../json";
import { MINUTE } from "../candles/kline";
import type { Trade } from "../venues/types";
import type { BinanceRest } from "./rest";

export type AggTrade = { id: number; time: number; first: number; last: number; price: string; quantity: string; maker: boolean };

export function parseAggTrade(data: unknown): AggTrade {
  const id = prop(data, "a"), time = prop(data, "T"), first = prop(data, "f"), last = prop(data, "l");
  const price = prop(data, "p"), quantity = prop(data, "q"), maker = prop(data, "m");
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0 || typeof time !== "number" || !Number.isSafeInteger(time) || time < 0 || typeof first !== "number" || !Number.isSafeInteger(first) || typeof last !== "number" || !Number.isSafeInteger(last) || last < first || typeof price !== "string" || !/^\d+(\.\d{1,8})?$/.test(price) || typeof quantity !== "string" || !/^\d+(\.\d{1,8})?$/.test(quantity) || typeof maker !== "boolean") throw new Error("Invalid aggregate trade");
  return { id, time, first, last, price, quantity, maker };
}

/** The buyer is the maker when the taker sold. */
export function toTrade(trade: AggTrade): Trade {
  return { time: trade.time, price: trade.price, quantity: trade.quantity, count: trade.last - trade.first + 1, takerBuy: !trade.maker };
}

type State = { lastId: number | undefined; chain: Promise<void> };

/**
 * Delivers each symbol's aggregate trades exactly once and in id order. Before the first live
 * trade, and after any id gap (reconnects), the missing trades are fetched from REST, so no
 * live trade passes an unrepaired gap. Per-symbol ordering survives reconnects.
 */
export class TradePublisher {
  private readonly states = new Map<string, State>();
  private stopped = false;

  constructor(private readonly rest: Pick<BinanceRest, "aggTrades">, private readonly deliver: (symbol: string, trade: AggTrade) => void) {}

  accept(symbol: string, trade: AggTrade): Promise<void> {
    let state = this.states.get(symbol);
    if (!state) {
      state = { lastId: undefined, chain: Promise.resolve() };
      this.states.set(symbol, state);
    }
    const current = state;
    const work = current.chain.then(async () => {
      while (!this.stopped && (current.lastId === undefined || current.lastId + 1 < trade.id)) {
        const rows = await this.rest.aggTrades(symbol, current.lastId === undefined ? { startTime: Math.floor(trade.time / MINUTE) * MINUTE } : { fromId: current.lastId + 1 });
        let advanced = false;
        for (const row of rows) {
          if (row.id >= trade.id) break;
          if (current.lastId !== undefined && row.id <= current.lastId) continue;
          this.apply(symbol, current, row);
          advanced = true;
        }
        if (!advanced) {
          if (current.lastId === undefined) break;
          throw new Error(`Unfilled aggregate trade gap for ${symbol}`);
        }
      }
      if (!this.stopped) this.apply(symbol, current, trade);
    });
    current.chain = work.catch(() => {});
    return work;
  }

  private apply(symbol: string, state: State, trade: AggTrade): void {
    if (state.lastId !== undefined && trade.id <= state.lastId) return;
    if (state.lastId !== undefined && trade.id !== state.lastId + 1) throw new Error(`Non-contiguous aggregate trades for ${symbol}`);
    state.lastId = trade.id;
    this.deliver(symbol, trade);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.all([...this.states.values()].map(state => state.chain));
  }
}
