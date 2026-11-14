import type { OutlayerSetupView } from "@dya/wallet-contracts/src/domain/outlayer-setup";
import type { SetupQuotePreview } from "@dya/wallet-contracts/src/domain/outlayer-quote";
type RecoveryState = { phase: "idle" } | { phase: "authorizing" | "registering" | "testing"; id: string } | { phase: "prepared" } | { phase: "error"; message: string };
type QuoteState = { phase: "idle" } | { phase: "loading"; id: string; asset: SetupPaymentAsset } | { phase: "ready" | "expired"; quote: Extract<SetupQuotePreview, { status: "estimated" }> } | { phase: "unavailable"; reason: string };
export type SetupPaymentAsset = "USDC" | "NEAR";
export type SetupState = (
  | { phase: "loading" }
  | { phase: "review"; setup: OutlayerSetupView }
  | { phase: "checking"; setup: OutlayerSetupView }
  | { phase: "verified"; setup: OutlayerSetupView }
  | { phase: "error"; message: string; setup?: OutlayerSetupView }) & { paymentAsset?: SetupPaymentAsset; quote?: QuoteState; recovery?: RecoveryState };
export type SetupEvent = { type: "refresh-setup" } | { type: "recovery-start"; id: string } | { type: "recovery-advance"; id: string; phase: "registering" | "testing" } | { type: "recovery-complete"; id: string; setup: OutlayerSetupView } | { type: "recovery-failed"; id: string; message: string } | { type: "quote"; id: string } | { type: "quoted"; id: string; quote: SetupQuotePreview; now: number } | { type: "quote-failed"; id: string } | { type: "quote-expired"; planHash: string; now: number } | { type: "payment-asset"; asset: SetupPaymentAsset } | { type: "loaded"; setup: OutlayerSetupView } | { type: "check" } | { type: "failed"; message: string } | { type: "retry" };
function transitionSetup(state: SetupState, event: SetupEvent): SetupState | undefined {
  if (event.type === "loaded" && state.phase === "loading") return { phase: "review", setup: event.setup };
  if (event.type === "loaded" && state.phase === "checking") return event.setup.owner === "verified" ? { phase: "verified", setup: event.setup } : { phase: "error", setup: event.setup, message: "Verification was not confirmed. Try again." };
  if (event.type === "failed" && (state.phase === "loading" || state.phase === "checking")) return { phase: "error", message: event.message, ...(state.phase === "checking" ? { setup: state.setup } : {}) };
  if (event.type === "check" && state.phase === "review") return { phase: "checking", setup: state.setup };
  if (event.type === "retry" && state.phase === "error") return { phase: "loading" };
}
export function nextSetup(state: SetupState, event: SetupEvent): SetupState | undefined {
  if (event.type === "refresh-setup" && state.phase !== "checking") return { phase: "loading", paymentAsset: state.paymentAsset };
  const recoveryBusy = state.recovery && ["authorizing", "registering", "testing"].includes(state.recovery.phase);
  if (event.type === "recovery-start") {
    if (state.phase === "loading" || state.phase === "checking" || state.quote?.phase === "loading" || recoveryBusy || !("setup" in state) || state.setup?.recovery?.status !== "needed") return;
    return { ...state, recovery: { phase: "authorizing", id: event.id }, quote: { phase: "idle" } };
  }
  if (event.type === "recovery-advance" || event.type === "recovery-complete" || event.type === "recovery-failed") {
    if (!state.recovery || !("id" in state.recovery) || state.recovery.id !== event.id) return;
    if (event.type === "recovery-failed") return { ...state, recovery: { phase: "error", message: event.message } };
    if (event.type === "recovery-complete") {
      if (state.recovery.phase !== "testing" || event.setup.recovery?.status !== "prepared" || !("setup" in state)) return;
      return { ...state, setup: event.setup, recovery: { phase: "prepared" } };
    }
    if (state.recovery.phase === "authorizing" && event.phase === "registering" || state.recovery.phase === "registering" && event.phase === "testing") return { ...state, recovery: { phase: event.phase, id: event.id } };
    return;
  }
  if (recoveryBusy) return;
  if (event.type === "quote") {
    if (state.phase === "loading" || state.phase === "checking" || state.quote?.phase === "loading") return;
    return { ...state, quote: { phase: "loading", id: event.id, asset: state.paymentAsset ?? "USDC" } };
  }
  if (event.type === "quoted") {
    if (state.quote?.phase !== "loading" || state.quote.id !== event.id || state.quote.asset !== event.quote.asset) return;
    return { ...state, quote: event.quote.status === "unavailable" ? { phase: "unavailable", reason: event.quote.reason } : { phase: event.quote.expiresAt <= event.now ? "expired" : "ready", quote: event.quote } };
  }
  if (event.type === "quote-failed") {
    if (state.quote?.phase !== "loading" || state.quote.id !== event.id) return;
    return { ...state, quote: { phase: "unavailable", reason: "Setup estimate is unavailable. Try again." } };
  }
  if (event.type === "quote-expired") {
    if (state.quote?.phase !== "ready" || state.quote.quote.planHash !== event.planHash || event.now < state.quote.quote.expiresAt) return;
    return { ...state, quote: { phase: "expired", quote: state.quote.quote } };
  }
  if (event.type === "payment-asset") {
    if (state.phase === "checking" || state.phase === "loading") return;
    if (event.asset !== "USDC" && event.asset !== "NEAR") return;
    return { ...state, paymentAsset: event.asset, quote: { phase: "idle" } };
  }
  if (event.type === "check" && state.quote?.phase === "loading") return;
  const next = transitionSetup(state, event);
  return next && { ...next, ...(state.recovery ? { recovery: state.recovery } : {}), ...(state.paymentAsset ? { paymentAsset: state.paymentAsset } : {}), ...(state.quote ? { quote: state.quote } : {}) };
}
export function setupPresentation(state: SetupState) {
  const recovery = state.recovery ?? { phase: "idle" as const };
  const recovering = ["authorizing", "registering", "testing"].includes(recovery.phase);
  const recoveryLabel = recovery.phase === "authorizing" ? "Approve with your current passkey…" : recovery.phase === "registering" ? "Create a separate recovery passkey…" : recovery.phase === "testing" ? "Test your recovery passkey…" : "Add recovery passkey";
  return { recovery, recoveryLabel, recovering, quote: state.quote ?? { phase: "idle" as const }, paymentAsset: state.paymentAsset ?? "USDC", setup: "setup" in state ? state.setup : undefined, busy: recovering || state.phase === "loading" || state.phase === "checking", disabled: recovering || state.phase === "loading" || state.phase === "checking" || state.phase === "verified", success: state.phase === "verified", label: state.phase === "checking" ? "Checking passkey…" : state.phase === "loading" ? "Loading…" : state.phase === "error" ? "Retry" : state.phase === "verified" ? "Passkey verified" : state.setup.owner === "verified" ? "Check again" : "Check passkey", action: state.phase === "error" ? "retry" as const : state.phase === "review" ? "check" as const : null, error: state.phase === "error" ? state.message : undefined };
}
