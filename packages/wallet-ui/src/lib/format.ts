import { formatNumber } from "@dya/ui/lib/format-number";

export function decimal(value: string | null | undefined, options: Intl.NumberFormatOptions = {}): string {
  const formatted = formatNumber(value, { intl: options });
  return formatted === "-" ? "Unavailable" : formatted;
}

export const money = (value: string | null | undefined) => value == null ? "Unavailable" : `${formatNumber(value, { unit: "USDT" })} USDT`
export const percent = (value: string | null | undefined) => value == null ? "Unavailable" : decimal(value, { style: "percent", maximumFractionDigits: 2 })
export const utc = (value: string | null | undefined) => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }).format(new Date(value)) + " UTC" : "Unavailable"

/** Compatibility export for existing callers. */
export const formatTokenAmount = (value: string | null | undefined, unit?: string) => { const formatted = value && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) ? formatNumber(value, { unit }) : "-"; return formatted === "-" ? "Unavailable" : formatted; };

export { formatRelativeTime } from "@dya/ui/lib/format-relative-time";

/** Display only; always use the original address for transfers and copying. */
export function shortenAddress(address: string): string {
  const prefixLength = address.startsWith("0x") ? 6 : 4;
  return address.length > prefixLength + 5 ? `${address.slice(0, prefixLength)}…${address.slice(-4)}` : address;
}
