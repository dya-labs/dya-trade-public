import type { Kline } from "./kline";

const SCALE = 10n ** 18n;
const VOLUME_STEP = 10n ** 10n;

/** Plain decimal string (≤ 18 fraction digits) to integer units of 1e-18. */
export function units(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * SCALE + BigInt(fraction.padEnd(18, "0"));
}

/** Integer units of 1e-18 to the canonical plain decimal: no trailing fraction zeros, no "." for integers. */
export function decimal(value: bigint): string {
  const fraction = (value % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${value / SCALE}.${fraction}` : `${value / SCALE}`;
}

/** Truncates units of 1e-18 to the stored volume resolution of 1e-8. */
export function volumeUnits(value: bigint): bigint {
  return value - (value % VOLUME_STEP);
}

/** Exact plain decimal (any fraction length) times 10^`digits`, rounded half up. */
export function scaled(value: string, digits: number): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length <= digits) return BigInt(whole + fraction.padEnd(digits, "0"));
  const divisor = 10n ** BigInt(fraction.length - digits);
  return (BigInt(whole + fraction) * 2n + divisor) / (2n * divisor);
}

/**
 * Folds stored candles (ascending, all inside one bucket) into a bar opening at `time`,
 * continuing from `seed`, an already-aggregated prefix of the same bucket.
 * Binance fills minutes without trades with the previous close (OHLC = last price, zero
 * volume); Gate fills them with a moving reference price. Native longer candles of both take
 * open/high/low/close from traded candles only. So when the bucket has any traded candle
 * (volume > 0), OHLC come from traded candles; an untraded bucket keeps the filler values.
 * Sums are exact.
 */
export function foldBar(time: number, seed: Kline | undefined, minutes: readonly Kline[]): Kline | undefined {
  const all = seed ? [seed, ...minutes] : minutes;
  if (!all.length) return undefined;
  const traded = all.filter(kline => units(kline.volume) > 0n);
  const priced = traded.length ? traded : all;
  let high = units(priced[0]!.high), low = units(priced[0]!.low);
  for (const kline of priced) {
    const h = units(kline.high), l = units(kline.low);
    if (h > high) high = h;
    if (l < low) low = l;
  }
  let volume = 0n, quoteVolume = 0n, takerBuyVolume = 0n, takerBuyQuoteVolume = 0n, trades = 0;
  for (const kline of all) {
    volume += units(kline.volume);
    quoteVolume += units(kline.quoteVolume);
    takerBuyVolume += units(kline.takerBuyVolume);
    takerBuyQuoteVolume += units(kline.takerBuyQuoteVolume);
    trades += kline.trades;
  }
  return {
    openTime: time, open: priced[0]!.open, high: decimal(high), low: decimal(low), close: priced.at(-1)!.close,
    volume: decimal(volume), quoteVolume: decimal(quoteVolume), trades,
    takerBuyVolume: decimal(takerBuyVolume), takerBuyQuoteVolume: decimal(takerBuyQuoteVolume),
  };
}

/** Compact wire row, Binance-like: [openTime, o, h, l, c, v, quoteV, trades, takerBuyV, takerBuyQuoteV]. */
export type WireBar = [number, string, string, string, string, string, string, number, string, string];

export function wireBar(bar: Kline): WireBar {
  return [bar.openTime, bar.open, bar.high, bar.low, bar.close, bar.volume, bar.quoteVolume, bar.trades, bar.takerBuyVolume, bar.takerBuyQuoteVolume];
}
