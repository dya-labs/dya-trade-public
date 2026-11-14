export type DemoAccount = { id: string; name: string; type: "Standard" | "Trading"; balance: string };
export const demoAccounts: DemoAccount[] = [
  { id: "standard", name: "Main", type: "Standard", balance: "$240.56" },
  { id: "trading", name: "Main", type: "Trading", balance: "$125.00" },
  { id: "research", name: "Research", type: "Trading", balance: "$42.80" },
];
export type DemoState = { phase: "accounts"; accounts: DemoAccount[]; selected: string; note?: string } | { phase: "create"; accounts: DemoAccount[]; selected: string };
export type DemoEvent = { type: "select"; id: string } | { type: "create" } | { type: "confirm" } | { type: "back" } | { type: "notice"; text: string };
export function nextDemo(state: DemoState, event: DemoEvent): DemoState | undefined {
  if (event.type === "select" && state.phase === "accounts" && state.accounts.some(a => a.id === event.id)) return { ...state, selected: event.id, note: "Example account selected. No funds moved." };
  if (event.type === "create" && state.phase === "accounts") return { ...state, phase: "create" };
  if (event.type === "back" && state.phase === "create") return { ...state, phase: "accounts" };
  if (event.type === "notice" && state.phase === "accounts") return { ...state, note: event.text };
  if (event.type === "confirm" && state.phase === "create") {
    const id = `demo-${state.accounts.length}`;
    return { phase: "accounts", accounts: [...state.accounts, { id, name: `Trading ${state.accounts.filter(a => a.type === "Trading").length + 1}`, type: "Trading", balance: "$0.00" }], selected: id, note: "Demo account added locally. No wallet was provisioned." };
  }
}
export type VariantProps = { account: DemoAccount; accounts: DemoAccount[]; onSelect(id: string): void; onCreate(): void };
export const popupClass = "z-50 max-w-[calc(100vw-2rem)] rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-border outline-none";
export const rowClass = "flex w-full cursor-default items-center gap-3 rounded-sm px-3 py-2.5 text-sm outline-none data-highlighted:bg-hover focus-visible:bg-hover";
export const triggerClass = "group flex max-w-full items-center gap-3 rounded-md bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

export const headerGhostClass = "rounded-full hover:bg-foreground/6 aria-expanded:bg-foreground/6";
