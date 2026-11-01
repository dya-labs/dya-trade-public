import type { ClickHouse } from "../clickhouse";
import { MINUTE } from "./kline";

export type MarketRef = { venue: string; symbol: string };
// A market's last close carries over minutes without a stored candle for at most this long.
const CARRY_MS = 60 * MINUTE;

/**
 * A market's stored 1m closes for minutes in [from, to), carrying the previous close over minutes
 * the store lacks (up to an hour back); `syncedTo` is the exclusive end of its stored minutes.
 * Keys are minute open times, so `from` may be any instant (e.g. a trade's time).
 */
export async function marketCloses(clickhouse: ClickHouse, market: MarketRef, from: number, to: number): Promise<{ closes: Map<number, string>; syncedTo: number }> {
  const start = Math.floor(from / MINUTE) * MINUTE;
  const [rows, state] = await Promise.all([
    clickhouse.query<{ time: number; close: string }>(
      `SELECT toUnixTimestamp64Milli(open_time) AS time, toString(close) AS close FROM klines_1m FINAL
       WHERE venue = {venue:String} AND symbol = {symbol:String}
         AND open_time >= fromUnixTimestamp64Milli({from:Int64}, 'UTC') AND open_time < fromUnixTimestamp64Milli({to:Int64}, 'UTC')
       ORDER BY open_time`,
      { venue: market.venue, symbol: market.symbol, from: start - CARRY_MS, to }),
    clickhouse.query<{ synced: number }>(
      `SELECT toUnixTimestamp64Milli(synced_to) AS synced FROM sync_state FINAL
       WHERE venue = {venue:String} AND symbol = {symbol:String} AND dataset = 'klines_1m'`, { venue: market.venue, symbol: market.symbol }),
  ]);
  const closes = new Map<number, string>();
  let last: { time: number; close: string } | undefined, index = 0;
  for (let minute = start - CARRY_MS; minute < to; minute += MINUTE) {
    while (index < rows.length && Number(rows[index]!.time) <= minute) last = { time: Number(rows[index]!.time), close: rows[index++]!.close };
    if (minute >= start && last !== undefined && minute - last.time <= CARRY_MS) closes.set(minute, last.close);
  }
  return { closes, syncedTo: Number(state[0]?.synced ?? 0) };
}
