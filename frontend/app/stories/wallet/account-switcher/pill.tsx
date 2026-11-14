import { cn } from "@dya/ui/lib/utils";
import { Menu, MenuContent, MenuTrigger, MenuRadioGroup, MenuRadioItem, MenuItem } from "@ui-sdk/react/menu";
import { Check, ChevronsUpDown } from "@dya/ui/icons";
import { BorderedAvatar } from "./shared";
import { popupClass, rowClass, triggerClass, type VariantProps } from "./model";
export function AccountPill({ account, accounts, onSelect, onCreate }: VariantProps) {
  return <div className="flex min-w-0 items-center gap-3"><BorderedAvatar seed={account.id} />
    <Menu defaultOpen modal={false}>
      <MenuTrigger aria-label="Switch account" className={cn(triggerClass, "gap-2 rounded-full border border-control-border bg-control px-3 py-1.5 hover:bg-control-hover data-open:border-foreground/20")}>
        <span className="font-medium">{account.name}</span><span className="text-xs text-muted-foreground">{account.type}</span><ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </MenuTrigger>
      <MenuContent align="start" sideOffset={10} className={`${popupClass} w-72`}>
        <p className="px-3 py-2 text-xs text-muted-foreground">Your accounts</p>
        <MenuRadioGroup value={account.id} onValueChange={value => { if (value) onSelect(value); }}>
          {accounts.map(item => <MenuRadioItem closeOnSelect key={item.id} value={item.id} className={cn(rowClass, "py-2")}>
            <span className="size-4">{item.id === account.id && <Check className="size-4 text-primary" />}</span><span className="flex-1">{item.name}</span><span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">{item.type}</span>
          </MenuRadioItem>)}
        </MenuRadioGroup>
        <div className="my-1 h-px bg-border" /><MenuItem value="create" className={`${rowClass} text-primary`} onSelect={onCreate}>Create Trading account<span aria-hidden="true" className="ml-auto text-lg">+</span></MenuItem>
      </MenuContent>
    </Menu>
  </div>;
}
