"use client";
import { DYA_WALLET_NAMES } from "@dya/config";
import { useEffect, useRef, type ComponentProps } from "react";
import { Badge } from "@dya/ui/components/badge";
import { Button as UiSdkButton } from "@ui-sdk/react/button";
import { buttonVariants } from "@dya/ui/components/button";
import { cn } from "@dya/ui/lib/utils";
import { Card, CardContent } from "@dya/ui/components/card";
import { ExperimentalChoiceGroup } from "@dya/ui/components/experimental-choice-group";
import { useMachine } from "@dya/ui/hooks/use-machine";
import { Check, LoaderCircle } from "@dya/ui/icons";
import { activationPreviewView, nextActivationPreview, type ActivationPreviewState, type PreviewScenario } from "@dya/ui/lib/trading-activation-preview";

function PreviewButton({ variant = "default", className, ...props }: ComponentProps<typeof UiSdkButton> & { variant?: "default" | "outline" | "link" }) {
  return <UiSdkButton {...props} className={cn(buttonVariants({ variant }), className)} />;
}

const choices = [
  { value: "standard", label: DYA_WALLET_NAMES.main, description: "Confirm each trade with your passkey. Keep your current account." },
  { value: "trading", label: "Trading", description: "Planned: approve trading once for up to 24 hours. One-time setup cost.", badge: "Preview" },
];
const stages = [{ key: "payment", label: "Confirm setup payment" }, { key: "account", label: `Create ${DYA_WALLET_NAMES.legacyTrading} · Trading` }, { key: "policy", label: "Verify ownership and permissions" }] as const;
export function TradingActivationPreview({ initialState = { phase: "choose", selected: "standard" }, scenario = "success" }: { initialState?: ActivationPreviewState; scenario?: PreviewScenario }) {
  const [state, send] = useMachine(nextActivationPreview, initialState);
  const view = activationPreviewView(state);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [state.phase]);
  useEffect(() => {
    if (state.phase !== "activating" && state.phase !== "reconciling" && state.phase !== "refund") return;
    const timer = setTimeout(() => send({ type: state.phase === "activating" && state.step === "policy" && scenario === "policy-failure" ? "failed" : state.phase === "activating" && state.step === "payment" && scenario === "payment-uncertain" ? "unknown" : "completed" }), 1400);
    return () => clearTimeout(timer);
  }, [state, scenario, send]);
  return <section className="mx-auto w-full max-w-[440px] space-y-4 p-4 text-foreground">
    <p className="text-xs text-muted-foreground">Interactive prototype · Sample fees and balances. No passkey, payment or wallet operation is performed.</p>
    <Card><CardContent className="space-y-5 pt-5">
      <div className="space-y-2"><Badge variant="secondary">Trading preview</Badge><h1 ref={heading} tabIndex={-1} className="text-xl font-medium outline-none">{view.title}</h1></div>
      {state.phase === "choose" && <><p className="text-sm text-muted-foreground">Add a Trading account when you’re ready. Your {DYA_WALLET_NAMES.main} account stays available.</p><ExperimentalChoiceGroup label="Account type" choices={choices} value={state.selected} onValueChange={value => send({ type: "select", value })} /><p className="text-xs text-muted-foreground">{DYA_WALLET_NAMES.main} is your existing wallet. Trading accounts are named separately.</p></>}
      {state.phase === "standard" && <p className="text-sm text-muted-foreground">{DYA_WALLET_NAMES.main} stays as it is. You can create a Trading account later.</p>}
      {(state.phase === "review" || state.phase === "expired") && <><p className="text-sm text-muted-foreground">Pay from {DYA_WALLET_NAMES.main}. This covers setup only; your trading balance is transferred separately.</p><dl className="space-y-3 text-sm">{[["Account creation", "0.06 USDC"], ["Policy storage deposit", "0.18 USDC"], ["Estimated gas", "0.04 USDC"], ["Conversion and routing", "0.02 USDC"], ["Estimated setup total", "0.30 USDC"], ["Maximum payment", "0.35 USDC"], [`Available in ${DYA_WALLET_NAMES.main}`, "12.40 USDC"]].map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{value}</dd></div>)}</dl><p className="text-xs text-muted-foreground">Unused payment returns to {DYA_WALLET_NAMES.main}. The storage deposit stays reserved while the policy exists; refundable storage is separate from unused payment.</p>{state.phase === "review" ? <><p className="text-xs text-muted-foreground">Sample quote · valid until the expiry scenario is triggered.</p><PreviewButton variant="link" className="h-auto p-0" onClick={() => send({ type: "expire" })}>Preview expired quote</PreviewButton></> : <p role="alert" className="text-sm text-warning">Refresh the quote before approving. No payment has been made.</p>}</>}
      {(state.phase === "activating" || state.phase === "reconciling") && <><ol className="space-y-4">{stages.map((stage, i) => { const current = state.phase === "reconciling" ? 0 : stages.findIndex(s => s.key === state.step); return <li key={stage.key} className="flex items-center gap-3 text-sm">{i < current ? <Check className="size-4 text-primary" /> : i === current ? <LoaderCircle className="size-4 animate-spin" /> : <span className="size-4 rounded-full border border-input" />}<span className={i > current ? "text-muted-foreground" : undefined}>{stage.label}</span></li>; })}</ol><p role="status" className="text-sm text-muted-foreground">{state.phase === "reconciling" ? "Looking up the same payment. No second charge is requested." : "Keep this request open. Funding becomes available after ownership is verified."}</p></>}
      {state.phase === "uncertain" && <p role="status" className="text-sm text-muted-foreground">We haven’t confirmed whether your payment settled. Check the existing payment before starting another setup. You won’t be asked to pay again here.</p>}
      {state.phase === "refund" && <><p role="alert" className="text-sm">Ownership verification did not complete. Trading and funding remain unavailable.</p><p role="status" className="text-sm text-muted-foreground">Sample payment: 0.35 USDC. Setup used 0.10 USDC. Returning the unused 0.25 USDC to {DYA_WALLET_NAMES.main}…</p></>}
      {state.phase === "refunded" && <><p role="status" className="text-sm">0.25 USDC returned to {DYA_WALLET_NAMES.main}.</p><p className="text-sm text-muted-foreground">Setup used 0.10 USDC. {DYA_WALLET_NAMES.legacyTrading} · Trading is not ready and cannot receive trading funds. Your {DYA_WALLET_NAMES.main} account remains available.</p></>}
      {state.phase === "ready" && <><p role="status" className="text-sm">{DYA_WALLET_NAMES.legacyTrading} · Trading is ready in this simulation.</p><dl className="space-y-2 text-sm"><div className="flex justify-between"><dt>Trading balance</dt><dd>0.00 USDC</dd></div><div className="flex justify-between"><dt>Unused payment returned</dt><dd>0.05 USDC</dd></div></dl><p className="text-sm text-muted-foreground">Choose how much to transfer from {DYA_WALLET_NAMES.main}. Trading access starts only when you approve it; no 24-hour session is active yet.</p><p className="text-xs text-muted-foreground">Once enabled, placed limit orders may remain active after trading access expires, until filled, cancelled or their own deadline.</p></>}
      {state.phase === "funding" && <p className="text-sm text-muted-foreground">Funding is a separate step. This prototype stops here: no transfer is prepared and no funds are moved.</p>}
      <div className="flex gap-2">{view.canGoBack && <PreviewButton variant="outline" onClick={() => send({ type: "back" })}>Back</PreviewButton>}{view.action && <PreviewButton className="flex-1" onClick={() => { if (view.action) send({ type: view.action }); }}>{view.label}</PreviewButton>}{view.busy && <PreviewButton className="w-full" disabled><LoaderCircle className="animate-spin" />{state.phase === "refund" ? "Returning unused payment…" : "Please wait…"}</PreviewButton>}</div>
    </CardContent></Card>
  </section>;
}
