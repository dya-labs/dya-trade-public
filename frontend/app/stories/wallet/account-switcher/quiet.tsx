import { cn } from "@dya/ui/lib/utils";
import { Menu, MenuContent, MenuTrigger, MenuRadioGroup, MenuRadioItem, MenuItem } from "@ui-sdk/react/menu";
import { Badge } from "@dya/ui/components/badge";
import { Check, ChevronDown } from "@dya/ui/icons";
import { BorderedAvatar } from "./shared";
import { popupClass, rowClass, triggerClass, type VariantProps } from "./model";
export function QuietIdentity({ account, accounts, onSelect, onCreate }: VariantProps) {
  return <Menu defaultOpen modal={false}>
    <MenuTrigger aria-label="Switch account" className={cn(triggerClass, "gap-2.5 p-0")}>
      <BorderedAvatar seed={account.id} /><span className="font-medium">{account.name}</span><Badge variant="secondary">{account.type}</Badge>
      <span className="flex size-6 items-center justify-center rounded-sm text-muted-foreground group-hover:bg-control-hover group-hover:text-foreground group-data-open:bg-control-hover"><ChevronDown className="size-3.5" /></span>
    </MenuTrigger>
    <MenuContent align="start" sideOffset={10} className={`${popupClass} w-72`}>
      <MenuRadioGroup value={account.id} onValueChange={value => { if (value) onSelect(value); }}>
        {accounts.map(item => <MenuRadioItem closeOnSelect key={item.id} value={item.id} className={rowClass}>
          <span className="flex-1"><span className="block font-medium">{item.name}</span><span className="text-xs text-muted-foreground">{item.type}</span></span>
          <span className="text-xs tabular-nums text-muted-foreground">{item.balance}</span><span className="size-4">{item.id === account.id && <Check className="size-4 text-primary" />}</span>
        </MenuRadioItem>)}
      </MenuRadioGroup>
      <div className="my-1 h-px bg-border" />
      <MenuItem value="create" className={`${rowClass} font-medium`} onSelect={onCreate}><span className="text-lg leading-none text-muted-foreground" aria-hidden="true">+</span>Create Trading account</MenuItem>
    </MenuContent>
  </Menu>;
}
