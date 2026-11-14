import { DYA_BRAND, TOAST_MESSAGES } from "@dya/config";
import { z } from "zod";
import type { AuthenticationResponseJSON, RegistrationResponseJSON, PublicKeyCredentialRequestOptionsJSON, PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";

export class WalletCancelledError extends Error {
  constructor() { super("Wallet confirmation was cancelled."); this.name = "NotAllowedError"; }
}
export class WalletQuoteExpiredError extends Error {
  constructor() { super("Quote expired. Review again for a new quote."); this.name = "WalletQuoteExpiredError"; }
}
async function call(path: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/wallet/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Wallet is unavailable");
  return data;
}
/**
 * Private workspace SDK. Hosted origin and callbacks come from server configuration.
 * Resolves with the server's session snapshot for the new connection; callers validate it.
 */
export type WalletPresentation = "dialog" | "popup" | null;
export interface ConnectOptions { onPresentationChange?: (mode: WalletPresentation) => void }
export async function connect(kind: "login" | "register" = "login", options?: ConnectOptions): Promise<unknown> {
  return (await launch({ action: "connect", kind }, true, options?.onPresentationChange)).state;
}
/** `flow`: the hosted approval flow the server created with this ceremony, when it did; otherwise one is created here. */
export async function startAuthentication({ optionsJSON, flow: prepared, popup }: { popup?: boolean; optionsJSON: PublicKeyCredentialRequestOptionsJSON; flow?: WalletFlow }): Promise<AuthenticationResponseJSON> {
  const { flow } = await launch({ action: "approval", challenge: optionsJSON.challenge }, false, undefined, prepared, popup);
  // Opaque receipt, not a WebAuthn assertion. The BFF retrieves the server result
  // bound to the grant and submit route; signed private payloads never reach the app.
  return { id: flow.flowId, dyaApproval: flow.flowId } as unknown as AuthenticationResponseJSON;
}
export async function startRegistration({ optionsJSON }: { optionsJSON: PublicKeyCredentialCreationOptionsJSON }): Promise<RegistrationResponseJSON> {
  const { flow } = await launch({ action: "approval", challenge: optionsJSON.challenge });
  return { id: flow.flowId, dyaApproval: flow.flowId } as unknown as RegistrationResponseJSON;
}
const flowSchema = z.object({ url: z.url(), flowId: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expires: z.number().int().positive() });
export interface WalletFlow { url: string; flowId: string; expires: number }
type FlowMessage = { type: string; flowId: string; code?: string; screen?: string; documentReadyMs?: number; responseMs?: number; serverReadMs?: number };
export interface DialogHandle { destroy: () => void; showPopupBlocked: (retry: () => void) => void }
type DialogRenderer = (flow: WalletFlow, onMessage: (message: FlowMessage) => void) => (() => void) | DialogHandle;
let renderer: DialogRenderer | undefined;
let displaying = false;
let preparing = false;
let preparationRenderer: ((cancel: () => void) => () => void) | undefined;
export function setPreparationRenderer(value: (cancel: () => void) => () => void) {
  preparationRenderer = value;
  return () => { if (preparationRenderer === value) preparationRenderer = undefined; };
}
function popupFeatures() {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return mobile ? undefined : `popup=yes,width=384,height=440,left=${Math.round(window.screenX + (window.innerWidth - 384) / 2)},top=${Math.round(window.screenY + 80)}`;
}
async function launch(body: unknown, connecting = false, onPresentationChange?: (mode: WalletPresentation) => void, prepared?: WalletFlow, forcePopup = false): Promise<{ flow: WalletFlow; state: unknown }> {
  if (preparing || displaying) throw new Error("Complete the current wallet request first.");
  preparing = true;
  const openedAt = performance.now();
  const controller = new AbortController();
  let presentation: WalletPresentation = null;
  const notifyPresentation = (mode: WalletPresentation) => {
    if (presentation === mode) return;
    presentation = mode;
    // Presentation observers must never interrupt wallet settlement/cleanup.
    try { onPresentationChange?.(mode); } catch { /* observer only */ }
  };
  const safari = connecting && /Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|Android/i.test(navigator.userAgent);
  // Reserve the popup synchronously during the click, before network work consumes user activation.
  let reserved: Window | null = null;
  if (forcePopup || safari || !renderer) {
    try {
      reserved = window.open("about:blank", "_blank", popupFeatures());
      if (reserved) {
        reserved.document.title = `${DYA_BRAND.idName}`;
        reserved.document.body.textContent = `Opening ${DYA_BRAND.idName}…`;
      }
    } catch { /* A blocked popup is retried through the existing fallback UI. */ }
  }
  if (reserved) notifyPresentation("popup");
  const cancel = () => { controller.abort(); reserved?.close(); };
  const destroy = !reserved ? preparationRenderer?.(cancel) : undefined;
  const closed = reserved ? setInterval(() => { if (reserved?.closed) cancel(); }, 100) : undefined;
  try {
    const flow = flowSchema.parse(prepared ?? await call("flow", body, controller.signal));
    const flowMs = Math.round(performance.now() - openedAt);
    console.debug("dya.wallet.open", JSON.stringify({ event: "flow_created", operation: connecting ? "connect" : "approval", flowMs, renderer: !!renderer }));
    if (controller.signal.aborted) throw new WalletCancelledError();
    if (reserved) reserved.location.replace(flow.url);
    destroy?.();
    preparing = false;
    const state = await display(flow, connecting, reserved, notifyPresentation, { openedAt, flowMs });
    return { flow, state };
  } catch (error) {
    reserved?.close();
    if (controller.signal.aborted) throw new WalletCancelledError();
    throw error;
  } finally {
    preparing = false;
    if (closed) clearInterval(closed);
    notifyPresentation(null);
    destroy?.();
  }
}
export function setDialogRenderer(value: DialogRenderer) {
  renderer = value;
  return () => { if (renderer === value) renderer = undefined; };
}
/** Resolves with the exchange's session snapshot for connections, undefined for approvals. */
function display(flow: WalletFlow, connecting = false, reserved: Window | null = null, onPresentationChange?: (mode: WalletPresentation) => void, timing?: { openedAt: number; flowMs: number }) {
  if (displaying) throw new Error("Complete the current wallet request first.");
  displaying = true;
  return new Promise<unknown>((resolve, reject) => {
    let dialog: (() => void) | DialogHandle | undefined;
    let popup: Window | null = reserved;
    let handled = false;
    let settled = false;
    const exchangeController = new AbortController();
    let ready = false;
    let readyReported = false;
    let popupScreen: "recover" | undefined;
    const origin = new URL(flow.url).origin;
    const destroyDialog = () => { if (typeof dialog === "function") dialog(); else dialog?.destroy(); dialog = undefined; };
    const cleanup = () => {
      exchangeController.abort();
      displaying = false; clearTimeout(timer); clearTimeout(readyTimer); clearInterval(closedTimer);
      window.removeEventListener("message", receivePopup); destroyDialog(); popup?.close(); onPresentationChange?.(null);
    };
    const fail = (error: unknown) => { if (settled) return; settled = true; handled = true; cleanup(); reject(error); };
    const message = async (data: FlowMessage) => {
      if (handled || data.flowId !== flow.flowId) return;
      if (data.type === "dya:ready") {
        ready = true; clearTimeout(readyTimer);
        if (!readyReported && timing) {
          readyReported = true;
          const totalMs = Math.round(performance.now() - timing.openedAt);
          const documentTiming = Object.fromEntries(["documentReadyMs", "responseMs", "serverReadMs"].flatMap(key => {
            const value = data[key as "documentReadyMs" | "responseMs" | "serverReadMs"];
            return typeof value === "number" && Number.isFinite(value) && value >= 0 ? [[key, Math.round(value)]] : [];
          }));
          console.debug("dya.wallet.open", JSON.stringify({ event: "ready", operation: connecting ? "connect" : "approval", mode: popup ? "popup" : "dialog", flowMs: timing.flowMs, screenMs: totalMs - timing.flowMs, totalMs, ...documentTiming }));
        }
        return;
      }
      if (data.type === "dya:fallback") {
        if (connecting && data.screen === "recover") popupScreen = "recover";
        openPopup(); return;
      }
      if (data.type === "dya:retry") { fail(new WalletQuoteExpiredError()); return; }
      if (data.type === "dya:cancel") { fail(new WalletCancelledError()); return; }
      if (data.type !== "dya:complete") return;
      if (connecting && (typeof data.code !== "string" || !data.code.trim())) {
        fail(new Error(TOAST_MESSAGES.walletConnectionIncomplete));
        return;
      }
      handled = true;
      try {
        const exchanged: { state?: unknown } | undefined = typeof data.code === "string" ? await call("exchange", { flowId: flow.flowId, code: data.code }, exchangeController.signal) : undefined;
        if (settled) return;
        settled = true; cleanup(); resolve(exchanged?.state);
      } catch (error) { fail(error); }
    };
    function receivePopup(event: MessageEvent) {
      if (!popup || event.source !== popup || event.origin !== origin || event.data?.flowId !== flow.flowId) return;
      void message(event.data);
    }
    function openPopup() {
      if (handled) return;
      if (popup && !popup.closed) { popup.focus(); return; }
      clearTimeout(readyTimer);
      if (timing) console.debug("dya.wallet.open", JSON.stringify({ event: "popup_fallback", operation: connecting ? "connect" : "approval", totalMs: Math.round(performance.now() - timing.openedAt) }));
      const popupUrl = new URL(flow.url);
      if (popupScreen) popupUrl.searchParams.set("screen", popupScreen);
      try { popup = window.open(popupScreen ? popupUrl.href : flow.url, "_blank", popupFeatures()); } catch { popup = null; }
      if (!popup) {
        if (dialog && typeof dialog !== "function") dialog.showPopupBlocked(openPopup);
        else fail(new Error(TOAST_MESSAGES.walletPopupBlocked));
        return;
      }
      destroyDialog(); popup.focus(); onPresentationChange?.("popup");
    }
    window.addEventListener("message", receivePopup);
    const timer = setTimeout(() => fail(new Error(TOAST_MESSAGES.walletRequestExpired)), Math.max(1, flow.expires - Date.now()));
    const readyTimer = setTimeout(() => { if (!ready && !handled) openPopup(); }, 8000);
    const closedTimer = setInterval(() => { if (popup?.closed) { onPresentationChange?.(null); if (!handled) fail(new WalletCancelledError()); } }, 100);
    const safariConnect = connecting && /Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|Android/i.test(navigator.userAgent);
    if (renderer && !reserved) {
      dialog = renderer(flow, data => { if (!popup) void message(data); });
      onPresentationChange?.("dialog");
    }
    if (reserved) { ready = true; clearTimeout(readyTimer); reserved.focus(); }
    else if (!renderer || safariConnect) openPopup();
  });
}
export async function disconnect() { await call("disconnect", {}); }

export type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
