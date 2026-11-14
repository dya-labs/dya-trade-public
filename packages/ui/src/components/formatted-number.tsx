import type { ComponentProps } from "react";
import { formatNumber, type FormatNumberOptions } from "../lib/format-number";
import { cn } from "../lib/utils";

type Props = Omit<ComponentProps<"span">, "children"> & FormatNumberOptions & {
  value: string | number | null | undefined;
  symbol?: string;
  estimated?: boolean;
  exactTooltip?: boolean;
};
export function FormattedNumber({ value, format, fractionDigits, intl, unit, symbol, estimated = false, exactTooltip = false, className, title, ...props }: Props) {
  const formatted = formatNumber(value, { format, fractionDigits, intl, unit: unit ?? symbol });
  const available = formatted !== "-";
  return <span {...props} className={cn("tabular-nums", className)} title={title ?? (exactTooltip && available ? `${value}${symbol ? ` ${symbol}` : ""}` : undefined)}>{available && estimated ? "≈ " : ""}{formatted}{available && symbol ? ` ${symbol}` : ""}</span>;
}
