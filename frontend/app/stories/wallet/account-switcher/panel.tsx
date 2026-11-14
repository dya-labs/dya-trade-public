import { cn } from "@dya/ui/lib/utils";
import { Popover, PopoverTrigger, PopoverContent, PopoverTitle, PopoverClose } from "@ui-sdk/react/popover";
import { Badge } from "@dya/ui/components/badge";
import { buttonVariants } from "@dya/ui/components/button";
import { Check, ChevronDown, Plus } from "@dya/ui/icons";
import { BorderedAvatar, TradingMark } from "./shared";
import { headerGhostClass, popupClass, triggerClass, type VariantProps } from "./model";
export function AccountPanel({ account, accounts, onSelect, onCreate, triggerTreatment = "circle" }: VariantProps & { triggerTreatment?: "circle" | "bare" | "split" | "inline" | "none" }) {
  return <Popover defaultOpen>
    <PopoverTrigger aria-label="Switch account" className={cn(triggerClass, "gap-0 p-0", triggerTreatment === "none" && buttonVariants({ variant: "ghost", className: cn("-ml-2 h-11 min-h-11 gap-0 px-2 py-0", headerGhostClass) }), triggerTreatment === "split" && "rounded-lg border border-control-border py-1 pl-1")}>
      <BorderedAvatar seed={account.id} compact={triggerTreatment === "none"} /><span className={cn("ml-3 flex min-w-0 flex-col items-start gap-0.5", triggerTreatment === "none" && "ml-2")}><span className="flex items-center gap-1.5 font-medium">{account.name}{triggerTreatment === "none" && account.type === "Trading" && <TradingMark />}{triggerTreatment === "inline" && <ChevronDown className="size-3 text-muted-foreground group-hover:text-foreground" />}</span>{triggerTreatment !== "none" && <span className="text-xs text-muted-foreground">{account.type}</span>}</span>
      {triggerTreatment === "circle" && <span className="ml-4 flex size-7 items-center justify-center rounded-full border border-control-border text-muted-foreground group-hover:bg-control-hover group-data-open:bg-control-hover"><ChevronDown className="size-3.5" /></span>}
      {triggerTreatment === "bare" && <ChevronDown className="ml-4 size-4 text-muted-foreground group-hover:text-foreground group-data-open:text-foreground" />}
      {triggerTreatment === "split" && <span className="ml-5 flex h-8 w-9 items-center justify-center border-l border-control-border text-muted-foreground group-hover:text-foreground group-data-open:text-foreground"><ChevronDown className="size-3.5" /></span>}
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={12} className={`${popupClass} w-80 p-0`}>
      <PopoverTitle className="sr-only">Your accounts</PopoverTitle>
      <div className="space-y-1 p-2">
        {accounts.map(item => <PopoverClose key={item.id} onClick={() => onSelect(item.id)} aria-label={`Use ${item.name} ${item.type}`} aria-current={item.id === account.id ? "true" : undefined} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-ring/35">
          <BorderedAvatar seed={item.id} small />{triggerTreatment === "none" ? <><span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium"><span className="truncate">{item.name}</span>{item.type === "Trading" && <TradingMark />}</span><span className="shrink-0 text-sm tabular-nums text-muted-foreground">{item.balance}</span></> : <><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.name}</span><span className="text-xs text-muted-foreground">{item.balance}</span></span><Badge variant="secondary">{item.type}</Badge><span className="size-4">{item.id === account.id && <Check className="size-4 text-primary" />}</span></>}
        </PopoverClose>)}
      </div>
      <div className="px-2 pb-2"><PopoverClose className={buttonVariants({ variant: "ghost", className: "h-9 w-full justify-start gap-3 px-2 py-0" })} onClick={onCreate}><span className="flex w-8 items-center justify-center"><Plus className="size-4" /></span>Create account</PopoverClose></div>
    </PopoverContent>
  </Popover>;
}
