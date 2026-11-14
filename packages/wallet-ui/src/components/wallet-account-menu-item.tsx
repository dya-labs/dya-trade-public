import type { ComponentProps } from "react";
import { AccountAvatar } from "@dya/ui/components/account-avatar";
import { DropdownMenuItem } from "@dya/ui/components/dropdown-menu";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { TradingAccountBadge } from "@dya/ui/components/trading-account-badge";

export function WalletAccountMenuItem({ name, seed, trading, selected, value, ...props }: {
  name: string;
  seed?: string | null;
  trading?: boolean;
  selected: boolean;
  value?: string | null;
} & Pick<ComponentProps<typeof DropdownMenuItem>, "render" | "onClick">) {
  return <DropdownMenuItem {...props} aria-label={`Use ${name}${trading ? " Trading" : ""}`} aria-current={selected ? "true" : undefined} className="gap-3 px-2 py-2">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-control-border bg-control p-1"><AccountAvatar seed={seed} size="sm" /></span>
    <span className="flex min-w-0 flex-1 items-center gap-2 font-medium"><span className="truncate">{name}</span>{trading && <TradingAccountBadge />}</span>
    {value !== undefined && <span className="shrink-0 tabular-nums text-muted-foreground">{value === null ? "—" : <FormattedNumber value={value} format="currency" />}</span>}
  </DropdownMenuItem>;
}
