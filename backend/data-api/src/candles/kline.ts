/** One closed or in-progress candle. Decimal fields are exact, plain decimal strings. */
export type Kline = {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  trades: number;
  takerBuyVolume: string;
  takerBuyQuoteVolume: string;
};

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Stored resolutions: every venue syncs 1m; venues with short 1m retention also sync native 1h/1d. */
export type Resolution = "1m" | "1h" | "1d";
export const RESOLUTION_MS: Record<Resolution, number> = { "1m": MINUTE, "1h": HOUR, "1d": DAY };

// Prices keep 18 fraction digits (sub-1e-8 tokens such as MOG); volumes keep 8.
const plain = /^(\d{1,20})(?:\.(\d+))?$/;

/** Validates a venue price: a plain decimal with at most 18 fraction digits. Trailing zeros are dropped. */
export function priceDecimal(value: unknown): string {
  const match = typeof value === "string" ? plain.exec(value) : null;
  if (!match || (match[2] ?? "").length > 18) throw new Error(`Invalid price decimal: ${String(value)}`);
  return trim(match[1]!, match[2] ?? "");
}

/** Validates a venue volume and truncates it to 8 fraction digits (the stored resolution). */
export function volumeDecimal(value: unknown): string {
  const match = typeof value === "string" ? plain.exec(value) : null;
  if (!match) throw new Error(`Invalid volume decimal: ${String(value)}`);
  return trim(match[1]!, (match[2] ?? "").slice(0, 8));
}

/**
 * Plain decimal string of a JSON number as the venue wrote it (shortest round-trip form),
 * expanding exponent notation exactly: 1.2e-7 -> "0.00000012". For venues that send numbers.
 */
export function numberDecimal(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Invalid decimal number: ${String(value)}`);
  const [mantissa = "", exponentText = "0"] = String(value).split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exponentText);
  if (point <= 0) return trim("0", "0".repeat(-point) + digits);
  if (point >= digits.length) return trim(digits + "0".repeat(point - digits.length), "");
  return trim(digits.slice(0, point), digits.slice(point));
}

function trim(whole: string, fraction: string): string {
  const digits = fraction.replace(/0+$/, "");
  return `${BigInt(whole)}${digits ? `.${digits}` : ""}`;
}

/** Builds a validated kline; `trades` and taker fields are 0 where the venue does not publish them. */
export function kline(fields: Record<keyof Kline, unknown>, resolution: Resolution = "1m"): Kline {
  const { openTime, trades } = fields;
  if (typeof openTime !== "number" || !Number.isSafeInteger(openTime) || openTime < 0 || openTime % RESOLUTION_MS[resolution] !== 0) throw new Error("Invalid kline open time");
  if (typeof trades !== "number" || !Number.isSafeInteger(trades) || trades < 0 || trades > 0xffffffff) throw new Error("Invalid kline trade count");
  return {
    openTime, trades,
    open: priceDecimal(fields.open), high: priceDecimal(fields.high), low: priceDecimal(fields.low), close: priceDecimal(fields.close),
    volume: volumeDecimal(fields.volume), quoteVolume: volumeDecimal(fields.quoteVolume),
    takerBuyVolume: volumeDecimal(fields.takerBuyVolume), takerBuyQuoteVolume: volumeDecimal(fields.takerBuyQuoteVolume),
  };
}

/** ClickHouse JSONEachRow row for klines_1m. DateTime64 needs a string of milliseconds. */
export function klineRow(venue: string, symbol: string, bar: Kline) {
  return {
    venue, symbol, open_time: String(bar.openTime),
    open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    volume: bar.volume, quote_volume: bar.quoteVolume, trades: bar.trades,
    taker_buy_volume: bar.takerBuyVolume, taker_buy_quote_volume: bar.takerBuyQuoteVolume,
  };
}
