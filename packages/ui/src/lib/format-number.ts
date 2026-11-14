import Decimal from "decimal.js";

export type NumberFormat = "token" | "currency" | "price" | "percentage" | "compact" | "exact";
export type FormatNumberOptions = { format?: NumberFormat; fractionDigits?: number; intl?: Intl.NumberFormatOptions; unit?: string };

const USD_UNITS = new Set(["USD", "USDC", "USDT", "DAI", "USDS", "USDE", "PYUSD", "FDUSD", "TUSD", "LUSD", "FRAX", "GUSD", "USDD", "RLUSD", "USD1"]);

/**
 * Display only. Preserve decimal strings until rounding; never use this for order math.
 * Token amounts round down, so a balance never reads higher than what can be spent (9.999 USDC
 * shows 9.99); dollar values and prices round half-up.
 */
export function formatNumber(value: string | number | null | undefined, { format = "token", fractionDigits, intl, unit }: FormatNumberOptions = {}): string {
  if (typeof value === "number") { if (!Number.isFinite(value)) return "-"; value = new Decimal(value).toFixed(); }
  if (value == null || !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(String(value))) return "-";
  const amount = new Decimal(value);
  const usd = format !== "exact" && format !== "price" && format !== "compact" && (format === "currency" || (format === "token" && USD_UNITS.has(unit?.toUpperCase().replace(/\.E$/, "") ?? "")) || (intl?.style === "currency" && intl.currency === "USD" && intl.notation !== "compact"));
  if (usd) {
    const prefix = format === "currency" || intl?.style === "currency" ? "$" : "";
    if (!amount.isZero() && amount.abs().lt("0.01")) return `${amount.isNegative() ? "-" : ""}<${prefix}0.01`;
    return `${amount.isNegative() && !amount.isZero() ? "-" : ""}${prefix}${group(amount.abs().toFixed(2, prefix ? Decimal.ROUND_HALF_UP : Decimal.ROUND_DOWN))}`;
  }
  if (intl) return new Intl.NumberFormat("en-US", intl).format(value as unknown as number);
  if (format === "exact") return group(String(value));
  if (format === "token" && fractionDigits === undefined) return amount.isNegative() ? `-${tokenAmount(amount.abs().toFixed())}` : tokenAmount(amount.toFixed());
  if (format === "compact") {
    for (const [threshold, suffix] of [["1000000000000", "T"], ["1000000000", "B"], ["1000000", "M"], ["1000", "K"]] as const) {
      if (amount.abs().gte(threshold)) return `${group(amount.div(threshold).toDecimalPlaces(fractionDigits ?? 2).toFixed())}${suffix}`;
    }
  }
  const digits = fractionDigits ?? (format === "percentage" ? 2 : undefined);
  if (format === "price" && digits === undefined) return group(amount.toSignificantDigits(6, Decimal.ROUND_HALF_UP).toFixed());
  const rounded = digits === undefined ? amount.toFixed() : format === "token" ? amount.toFixed(digits, Decimal.ROUND_DOWN) : amount.toDecimalPlaces(digits, Decimal.ROUND_HALF_UP).toFixed();
  if (format === "token" && !amount.isZero() && new Decimal(rounded).isZero() && digits !== undefined) return `${amount.isNegative() ? "-" : ""}<${new Decimal(10).pow(-digits).toFixed()}`;
  // Percentages are supplied in percentage points, e.g. 1 means 1%.
  return `${group(rounded)}${format === "percentage" ? "%" : ""}`;
}
function group(value: string) {
  const [whole, fraction] = value.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
}

/** Short, conservative display for non-negative token balances. Never use for order math. */
function tokenAmount(value: string): string {
  if (!value || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) return "-";
  const amount = new Decimal(value);
  if (amount.isZero()) return "0";
  const fractionDigits = amount.gte(1000) ? 2 : amount.gte("0.01") ? 4 : 6;
  const display = amount.toDecimalPlaces(fractionDigits, Decimal.ROUND_DOWN).toFixed();
  if (display === "0") return `<${new Decimal(1).div(new Decimal(10).pow(fractionDigits)).toFixed()}`;
  const [whole, fraction] = display.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}


