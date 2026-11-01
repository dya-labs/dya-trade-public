import type { RedisClient } from "bun";
import { decimal, units } from "../candles/bar";
import { DAY, type Kline } from "../candles/kline";
import type { ClickHouse } from "../clickhouse";
import type { LiveSink } from "../venues/types";
import { liveKeys, type Ticker } from "./protocol";

/** Rolling 24h ticker from settled and live minutes; a market without trades keeps its last close. */
export function rollingTicker(symbol: string, minutes: readonly Kline[], lastClose: string | undefined, time: number): Ticker | undefined {
  const traded = minutes.filter(bar => bar.openTime >= time - DAY && units(bar.volume) > 0n).sort((a, b) => a.openTime - b.openTime);
  if (!traded.length) {
    return lastClose === undefined ? undefined : { symbol, lastPrice: lastClose, openPrice: lastClose, highPrice: lastClose, lowPrice: lastClose, volume: "0", quoteVolume: "0", changePercent: 0, eventTime: time };
  }
  let high = units(traded[0]!.high), low = units(traded[0]!.low), volume = 0n, quote = 0n;
  for (const bar of traded) {
    if (units(bar.high) > high) high = units(bar.high);
    if (units(bar.low) < low) low = units(bar.low);
    volume += units(bar.volume);
    quote += units(bar.quoteVolume);
  }
  const lastPrice = traded.at(-1)!.close, openPrice = traded[0]!.open, open = Number(openPrice);
  return {
    symbol, lastPrice, openPrice, highPrice: decimal(high), lowPrice: decimal(low), volume: decimal(volume), quoteVolume: decimal(quote),
    changePercent: open > 0 ? Math.round((Number(lastPrice) - open) / open * 1e6) / 1e4 : 0, eventTime: time,
  };
}

/**
 * Publishes rolling 24h tickers for venues built from our own trades (no venue ticker stream):
 * stored minutes of the last day, replaced by nothing newer, plus live minutes in Valkey.
 */
export async function publishRollingTickers(clickhouse: ClickHouse, redis: RedisClient, venue: string, symbols: readonly string[], sink: Pick<LiveSink, "ticker">): Promise<void> {
  const time = Date.now(), list = `[${symbols.map(symbol => `'${symbol}'`).join(",")}]`;
  const stored = await clickhouse.query<Kline & { symbol: string }>(
    `SELECT symbol, toUnixTimestamp64Milli(open_time) AS openTime, toString(open) AS open, toString(high) AS high, toString(low) AS low,
       toString(close) AS close, toString(volume) AS volume, toString(quote_volume) AS quoteVolume, trades,
       toString(taker_buy_volume) AS takerBuyVolume, toString(taker_buy_quote_volume) AS takerBuyQuoteVolume
     FROM klines_1m FINAL WHERE venue = {venue:String} AND symbol IN {symbols:Array(String)} AND open_time >= fromUnixTimestamp64Milli({from:Int64}, 'UTC')`,
    { venue, symbols: list, from: time - DAY });
  const last = await clickhouse.query<{ symbol: string; close: string }>(
    `SELECT symbol, toString(argMax(close, open_time)) AS close FROM klines_1m FINAL
     WHERE venue = {venue:String} AND symbol IN {symbols:Array(String)} AND volume > 0 GROUP BY symbol`,
    { venue, symbols: list });
  for (const symbol of symbols) {
    const minutes = new Map<number, Kline>();
    for (const [field, json] of Object.entries(await redis.hgetall(liveKeys(venue).recent(symbol)))) minutes.set(Number(field), JSON.parse(json));
    // Settled minutes replace their live versions.
    for (const bar of stored) if (bar.symbol === symbol) minutes.set(Number(bar.openTime), { ...bar, openTime: Number(bar.openTime) });
    const ticker = rollingTicker(symbol, [...minutes.values()], last.find(row => row.symbol === symbol)?.close, time);
    if (ticker) sink.ticker(ticker);
  }
}
