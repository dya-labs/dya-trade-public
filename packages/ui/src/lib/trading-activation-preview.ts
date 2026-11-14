import { DYA_WALLET_NAMES } from "@dya/config";
export type ActivationStep = "payment" | "account" | "policy";
export type PreviewScenario = "success" | "policy-failure" | "payment-uncertain";
export type ActivationPreviewState =
  | { phase: "choose"; selected: "standard" | "trading" }
  | { phase: "standard" }
  | { phase: "review" }
  | { phase: "expired" }
  | { phase: "activating"; step: ActivationStep }
  | { phase: "uncertain" }
  | { phase: "reconciling" }
  | { phase: "refund" }
  | { phase: "refunded" }
  | { phase: "ready" }
  | { phase: "funding" };
export type ActivationPreviewEvent =
  | { type: "select"; value: string | null }
  | { type: "continue" }
  | { type: "back" }
  | { type: "approve" }
  | { type: "expire" }
  | { type: "refresh" }
  | { type: "completed" }
  | { type: "failed" }
  | { type: "unknown" }
  | { type: "check" }
  | { type: "fund" }
  | { type: "restart" };
export function nextActivationPreview(state: ActivationPreviewState, event: ActivationPreviewEvent): ActivationPreviewState | undefined {
  if (state.phase === "choose") {
    if (event.type === "select" && (event.value === "standard" || event.value === "trading")) return { ...state, selected: event.value };
    if (event.type === "continue") return state.selected === "standard" ? { phase: "standard" } : { phase: "review" };
  }
  if (state.phase === "review") {
    if (event.type === "back") return { phase: "choose", selected: "trading" };
    if (event.type === "expire") return { phase: "expired" };
    if (event.type === "approve") return { phase: "activating", step: "payment" };
  }
  if (state.phase === "expired" && event.type === "refresh") return { phase: "review" };
  if (state.phase === "activating") {
    if (event.type === "unknown" && state.step === "payment") return { phase: "uncertain" };
    if (event.type === "failed" && state.step === "policy") return { phase: "refund" };
    if (event.type === "completed") return state.step === "payment" ? { phase: "activating", step: "account" } : state.step === "account" ? { phase: "activating", step: "policy" } : { phase: "ready" };
  }
  if (state.phase === "uncertain" && event.type === "check") return { phase: "reconciling" };
  if (state.phase === "reconciling" && event.type === "completed") return { phase: "activating", step: "account" };
  if (state.phase === "refund" && event.type === "completed") return { phase: "refunded" };
  if (state.phase === "ready" && event.type === "fund") return { phase: "funding" };
  if (["standard", "refunded", "ready", "funding"].includes(state.phase) && event.type === "restart") return { phase: "choose", selected: "standard" };
}
export function activationPreviewView(state: ActivationPreviewState) {
  const phase = state.phase;
  const titles = { choose: "Choose your account", standard: `Keep using ${DYA_WALLET_NAMES.main}`, review: "Review setup cost", expired: "Setup quote expired", activating: "Creating your Trading account", uncertain: "Payment status unconfirmed", reconciling: "Checking your payment", refund: "Setup paused", refunded: "Unused payment returned", ready: "Your Trading account is ready", funding: "Choose what to transfer" };
  const action: "continue" | "approve" | "refresh" | "check" | "fund" | "restart" | null = phase === "choose" ? "continue" : phase === "review" ? "approve" : phase === "expired" ? "refresh" : phase === "uncertain" ? "check" : phase === "ready" ? "fund" : ["standard", "refunded", "funding"].includes(phase) ? "restart" : null;
  const label = phase === "choose" ? state.selected === "standard" ? `Keep ${DYA_WALLET_NAMES.main}` : "Review setup cost" : phase === "review" ? "Simulate payment · 0.35 USDC" : phase === "expired" ? "Refresh quote" : phase === "uncertain" ? "Check payment status" : phase === "ready" ? "Add funds" : phase === "standard" ? "Explore Trading" : phase === "refunded" ? "Back to accounts" : "Restart preview";
  return { title: titles[phase], action, label, busy: phase === "activating" || phase === "reconciling" || phase === "refund", canGoBack: phase === "review" };
}
