import { kline, type Kline } from "../candles/kline";

/** GET /api/v3/klines row: [openTime, o, h, l, c, v, closeTime, qv, trades, tbv, tbqv, ignore]. */
export function parseRestKline(row: unknown): Kline {
  if (!Array.isArray(row) || row.length < 11) throw new Error("Invalid kline row");
  const [openTime, open, high, low, close, volume, , quoteVolume, trades, takerBuyVolume, takerBuyQuoteVolume]: unknown[] = row;
  return kline({ openTime, open, high, low, close, volume, quoteVolume, trades, takerBuyVolume, takerBuyQuoteVolume });
}
