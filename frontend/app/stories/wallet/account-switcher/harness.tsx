import { useEffect, useLayoutEffect, useRef } from "react";
import { AuthBrandCard } from "@dya/ui/components/auth-brand-card";
import { Button } from "@dya/ui/components/button";
import { Card, CardContent } from "@dya/ui/components/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuHeader, DropdownMenuItem, DropdownMenuTrigger } from "@dya/ui/components/dropdown-menu";
import { SettingsFilled, LogOut, ShieldCheck } from "@dya/ui/icons";
import { useMachine } from "@dya/ui/hooks/use-machine";
import { DYA_BRAND } from "@dya/config";
import { QuietIdentity } from "./quiet";
import { AccountPill } from "./pill";
import { AccountPanel } from "./panel";
import { PanelBare } from "./panel-bare";
import { PanelSplit } from "./panel-split";
import { PanelInline } from "./panel-inline";
import { PanelBadge } from "./panel-badge";
import { demoAccounts, headerGhostClass, nextDemo, type DemoState } from "./model";
import "./picker.css";

const variants = [{ name: "Quiet", component: QuietIdentity }, { name: "Pill", component: AccountPill }, { name: "Panel", component: AccountPanel }];
const panelVariants = [{ name: "Bare", component: PanelBare }, { name: "Split", component: PanelSplit }, { name: "Inline", component: PanelInline }];
type PickerState = { index: number; revision: number };
type PickerEvent = { type: "select"; index: number } | { type: "relative"; delta: number } | { type: "replay" };
export function nextAccountPicker(state: PickerState, event: PickerEvent): PickerState | undefined {
  if (event.type === "replay") return { ...state, revision: state.revision + 1 };
  const index = event.type === "relative" ? (state.index + event.delta + variants.length) % variants.length : event.index;
  if (index < 0 || index >= variants.length || !Number.isInteger(index)) return;
  return { index, revision: state.revision + 1 };
}
function initialIndex() {
  if (typeof window === "undefined") return 0;
  const value = Number(new URLSearchParams(window.location.search).get("v"));
  return Number.isInteger(value) && value >= 1 && value <= variants.length ? value - 1 : 0;
}
function Context({ variant, populated, round }: { variant: number; populated: boolean; round: "initial" | "panel" | "badge" }) {
  const [state, send] = useMachine(nextDemo, { phase: "accounts", accounts: populated ? demoAccounts : demoAccounts.slice(0, 1), selected: "standard" } as DemoState);
  const account = state.accounts.find(a => a.id === state.selected)!;
  const Variant = round === "badge" ? PanelBadge : (round === "panel" ? panelVariants : variants)[variant].component;
  return <main className="mx-auto flex min-h-dvh w-full max-lg:flex-col bg-background text-foreground">
    <AuthBrandCard brandName={DYA_BRAND.idName} title={<>Your assets.<br />Your privacy.</>} homeHref="#" />
    <section className="min-w-0 flex-1 py-4 lg:ml-[calc(45vw+1rem)] lg:py-6"><div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-24 sm:px-6">
      <header className="flex min-w-0 items-center justify-between gap-3">
        <Variant account={account} accounts={state.accounts} onSelect={id => send({ type: "select", id })} onCreate={() => send({ type: "create" })} />
        <DropdownMenu><DropdownMenuTrigger render={<Button size="icon" variant={round === "badge" ? "ghost" : "outline"} className={round === "badge" ? `size-11 ${headerGhostClass}` : undefined} aria-label="Settings" />}><SettingsFilled className={round === "badge" ? "size-4.5" : undefined} /></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-48"><DropdownMenuHeader>Personal</DropdownMenuHeader><DropdownMenuItem onClick={() => send({ type: "notice", text: "Recovery selected in the prototype." })}><ShieldCheck />Recovery wallet</DropdownMenuItem><DropdownMenuItem onClick={() => send({ type: "notice", text: "Sign out selected in the prototype; your real session is unchanged." })}><LogOut />Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </header>
      <p className="text-xs text-muted-foreground">Design exploration · sample accounts and balances only.</p>
      {state.phase === "create" ? <Card><CardContent className="space-y-4 pt-5"><h1>Create Trading account</h1><p className="text-sm text-muted-foreground">Try how a newly created account appears in this dropdown. This adds a local example with a zero balance; no setup payment or wallet is created.</p><div className="flex gap-2"><Button variant="outline" onClick={() => send({ type: "back" })}>Back</Button><Button className="flex-1" onClick={() => send({ type: "confirm" })}>Add demo Trading account</Button></div></CardContent></Card> : <>
        <section className="space-y-4"><h2>Balance</h2><p className="text-3xl tabular-nums">{account.balance}</p><p className="text-sm text-muted-foreground">{account.name} · {account.type}</p><div className="flex gap-2"><Button onClick={() => send({ type: "notice", text: `Receive for ${account.name} · ${account.type} selected. This demo does not create deposit addresses.` })}>Receive</Button><Button variant="outline" onClick={() => send({ type: "notice", text: `Send for ${account.name} · ${account.type} selected. No transfer was prepared.` })}>Send</Button></div></section>
        <section className="space-y-3"><h2>Assets</h2><Card className="gap-0 py-0"><CardContent className="flex items-center justify-between p-4"><span className="flex items-center gap-3"><span className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-medium">$</span><span className="text-sm">USDC</span></span><span className="text-sm tabular-nums">{account.balance.slice(1)}</span></CardContent></Card></section>
        <section className="space-y-3"><h2>Activity</h2><Card className="py-0"><CardContent className="py-10 text-center text-sm text-muted-foreground">No activity in this example account.</CardContent></Card></section>
      </>}
      {state.phase === "accounts" && state.note && <p role="status" className="text-xs text-muted-foreground">{state.note}</p>}
    </div></section>
  </main>;
}
export function AccountSwitcherExploration({ populated = true, round = "initial" }: { populated?: boolean; round?: "initial" | "panel" }) {
  const directions = round === "panel" ? panelVariants : variants;
  const [picker, send] = useMachine(nextAccountPicker, { index: initialIndex(), revision: 0 });
  const nav = useRef<HTMLElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    function measure() {
      const item = nav.current?.querySelectorAll<HTMLElement>(".proto-picker-item:not(.proto-picker-replay)")[picker.index];
      if (item && highlight.current) { highlight.current.style.width = `${item.offsetWidth}px`; highlight.current.style.transform = `translateX(${item.offsetLeft}px)`; }
    }
    measure(); window.addEventListener("resize", measure);
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => nav.current?.setAttribute("data-ready", "")));
    return () => { window.removeEventListener("resize", measure); cancelAnimationFrame(frame); };
  }, [picker.index]);
  useEffect(() => {
    const url = new URL(window.location.href); url.searchParams.set("v", String(picker.index + 1)); window.history.replaceState(null, "", url);
  }, [picker.index]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const number = Number.parseInt(event.key, 10);
      if (number >= 1 && number <= variants.length) { event.preventDefault(); send({ type: "select", index: number - 1 }); }
      else if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); send({ type: "relative", delta: event.key === "ArrowRight" ? 1 : -1 }); }
      else if (event.key.toLowerCase() === "r") { event.preventDefault(); send({ type: "replay" }); }
    }
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [send]);
  return <><Context key={`${round}-${picker.index}-${picker.revision}-${populated}`} variant={picker.index} populated={populated} round={round} />
    <nav ref={nav} className="proto-picker" aria-label="Prototype variants"><span ref={highlight} className="proto-picker-highlight" aria-hidden="true" />{directions.map((variant, index) => <button key={variant.name} className="proto-picker-item" data-active={index === picker.index ? "" : undefined} aria-current={index === picker.index ? "true" : undefined} onClick={() => send({ type: "select", index })}>{variant.name}</button>)}</nav>
  </>;
}

export function WalletBadgeExploration({ populated = true }: { populated?: boolean }) { return <Context variant={0} populated={populated} round="badge" />; }
