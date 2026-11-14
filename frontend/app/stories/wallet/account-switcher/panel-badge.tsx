import { Button } from "@dya/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@dya/ui/components/dropdown-menu";
import { Plus } from "@dya/ui/icons";
import { cn } from "@dya/ui/lib/utils";
import { BorderedAvatar, TradingMark } from "./shared";
import { headerGhostClass, type VariantProps } from "./model";

export function PanelBadge({ account, accounts, onSelect, onCreate }: VariantProps) {
  return <DropdownMenu defaultOpen modal={false}>
    <DropdownMenuTrigger render={<Button variant="ghost" className={cn("-ml-2 h-11 min-h-11 gap-2 py-0 pr-3 pl-2", headerGhostClass)} aria-label="Switch account" />}>
      <BorderedAvatar seed={account.id} compact /><span className="flex min-w-0 items-center gap-1.5 font-medium"><span className="truncate">{account.name}</span>{account.type === "Trading" && <TradingMark />}</span>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
      {accounts.map(item => <DropdownMenuItem key={item.id} aria-label={`Use ${item.name} ${item.type}`} aria-current={item.id === account.id ? "true" : undefined} onClick={() => onSelect(item.id)} className="gap-3 px-2 py-2">
        <BorderedAvatar seed={item.id} small /><span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium"><span className="truncate">{item.name}</span>{item.type === "Trading" && <TradingMark />}</span><span className="shrink-0 tabular-nums text-muted-foreground">{item.balance}</span>
      </DropdownMenuItem>)}
      <DropdownMenuItem onClick={onCreate} className="min-h-9 gap-3 px-2 py-0"><span className="flex w-8 items-center justify-center"><Plus className="size-4" /></span>Create account</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
