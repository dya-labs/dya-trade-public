import { decimal, units, volumeUnits } from "../../candles/bar";
import { marketCloses } from "../../candles/closes";
import { MINUTE } from "../../candles/kline";
import type { ClickHouse } from "../../clickhouse";
import type { Trade } from "../types";
import { USD, type QuoteSource } from "./catalog";
import { NORMAL_DECIMALS, type RouteTrade } from "./trades";

const SCALE = 10n ** 18n;
const NORMAL = 10n ** BigInt(NORMAL_DECIMALS);
const roundDiv = (numerator: bigint, denominator: bigint) => (numerator * 2n + denominator) / (2n * denominator);

/** USD per whole unit of a canonical asset in 1e-18 units, or undefined when unknown. */
export type Rate = (group: string) => bigint | undefined;

/**
 * A route trade as a trade of `group`'s USD market: quantity is the market asset's amount
 * (truncated to 1e-8), price is the other side's USD value per unit (rounded to 1e-18). It is a
 * taker buy when the route bought the market asset. Undefined when the trade doesn't involve the
 * market or the other side has no USD rate (`unpriced`).
 */
export function marketTrade(trade: RouteTrade, group: string, time: number, rate: Rate): Trade | "unpriced" | undefined {
  const buy = trade.bought.group === group;
  if (!buy && trade.sold.group !== group) return undefined;
  const [base, quote] = buy ? [trade.bought, trade.sold] : [trade.sold, trade.bought];
  const usd = quote.group === USD ? SCALE : rate(quote.group);
  if (usd === undefined) return "unpriced";
  const quantity = volumeUnits(base.amount * SCALE / NORMAL);
  const price = roundDiv(quote.amount * usd, base.amount);
  if (quantity <= 0n || price <= 0n) return undefined;
  return { time, price: decimal(price), quantity: decimal(quantity), count: 1, takerBuy: buy };
}

/**
 * Stored 1m USD closes of each quote asset's exchange markets for minutes in [from, to): at each
 * minute the best-ranked market valid then with a close. A minute no valid market has stored yet
 * is `pending`, so pages wait there instead of leaving trades unpriced.
 */
export async function historicalRates(clickhouse: ClickHouse, quotes: ReadonlyMap<string, QuoteSource[]>, groups: Iterable<string>, from: number, to: number) {
  const tables = new Map<string, { source: QuoteSource; closes: Map<number, string>; syncedTo: number }[]>();
  for (const group of groups) {
    if (group === USD || tables.has(group)) continue;
    const sources = quotes.get(group) ?? [];
    tables.set(group, await Promise.all(sources.map(async source => ({ source, ...await marketCloses(clickhouse, source, from, to) }))));
  }
  return {
    at(group: string, time: number): bigint | undefined {
      const minute = Math.floor(time / MINUTE) * MINUTE;
      for (const { source, closes } of tables.get(group) ?? []) {
        if (minute < source.validFrom || (source.validTo !== null && minute >= source.validTo)) continue;
        const close = closes.get(minute);
        if (close !== undefined) return units(close);
      }
      return undefined;
    },
    /** True while no market of `group` valid at `time` has stored that minute yet. */
    pending(group: string, time: number): boolean {
      const minute = Math.floor(time / MINUTE) * MINUTE;
      const valid = (tables.get(group) ?? []).filter(({ source }) => minute >= source.validFrom && (source.validTo === null || minute < source.validTo));
      return valid.length > 0 && valid.every(({ syncedTo }) => syncedTo <= minute);
    },
  };
}
