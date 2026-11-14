"use client";
import { DYA_BRAND } from "@dya/config";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { connect, disconnect, setDialogRenderer, setPreparationRenderer, type WalletFlow } from "@dya/wallet-sdk";
import { Dialog, DialogViewport, DialogTitle, DialogDescription } from "@dya/ui/components/dialog";
import { LoaderCircle } from "@dya/ui/icons";
import { Button } from "@dya/ui/components/button";
const Context = createContext({ connect, disconnect });
/** Internal provider: renders shared DYA UI dialogs and leaves authority on DYA ID. */
export function DyaProvider({ children }: { children: ReactNode }) {
  const [preparing, setPreparing] = useState<{ cancel: () => void } | null>(null);
  useEffect(() => setPreparationRenderer(cancel => { setPreparing({ cancel }); return () => setPreparing(null); }), []);
  const [popupRetry, setPopupRetry] = useState<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ flow: WalletFlow; cancel: () => void } | null>(null);
  useEffect(() => setDialogRenderer((flow, onMessage) => {
    let active = true;
    const origin = new URL(flow.url).origin;
    const receive = (event: MessageEvent) => {
      const frame = document.getElementById("dya-wallet-frame") as HTMLIFrameElement | null;
      if (!active || event.origin !== origin || event.source !== frame?.contentWindow || event.data?.flowId !== flow.flowId) return;
      if (event.data.type === "dya:ready") setReady(true);
      if (event.data.type === "dya:busy") setBusy(event.data.busy === true);
      onMessage(event.data);
    };
    window.addEventListener("message", receive);
    const cancel = () => onMessage({ type: "dya:cancel", flowId: flow.flowId });
    setPopupRetry(null);
    setBusy(false);
    setReady(false);
    setDialog({ flow, cancel });
    return {
      destroy: () => { active = false; window.removeEventListener("message", receive); setDialog(null); setPopupRetry(null); },
      showPopupBlocked: (retry: () => void) => { setBusy(false); setPopupRetry(() => retry); },
    };
  }), []);
  return <Context.Provider value={{ connect, disconnect }}>{children}<Dialog open={!!dialog || !!preparing} onOpenChange={open => { if (!open && !busy) (preparing?.cancel ?? dialog?.cancel)?.(); }}><DialogViewport><DialogTitle className="sr-only">{DYA_BRAND.idName}</DialogTitle><DialogDescription className="sr-only">Connect your wallet or approve a wallet action.</DialogDescription>{preparing || (dialog && !ready && !popupRetry) ? <div className="absolute inset-0 flex items-center justify-center"><div className="w-full max-w-sm space-y-4 rounded-lg border bg-popover p-5" role="status"><p className="flex items-center gap-2"><LoaderCircle className="size-4 " aria-hidden="true" />Opening {DYA_BRAND.idName}…</p><Button variant="outline" className="w-full" onClick={() => (preparing?.cancel ?? dialog?.cancel)?.()}>Cancel</Button></div></div> : null}{popupRetry ? <div className="absolute inset-0 flex items-center justify-center"><div className="w-full max-w-sm space-y-4 rounded-lg border bg-popover p-5"><p>Your browser blocked the wallet popup. Open it to continue.</p><Button className="w-full" onClick={popupRetry}>Open wallet popup</Button><Button variant="outline" className="w-full" onClick={() => dialog?.cancel()}>Cancel</Button></div></div> : dialog && <iframe id="dya-wallet-frame" title={`${DYA_BRAND.idName} wallet`} src={dialog.flow.url} className={`h-dvh w-full border-0 bg-transparent ${ready ? "visible" : "invisible"}`} allow={`publickey-credentials-get ${new URL(dialog.flow.url).origin}; publickey-credentials-create ${new URL(dialog.flow.url).origin}`} sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox" />}</DialogViewport></Dialog></Context.Provider>;
}
export function useDya() { return useContext(Context); }
export function WalletButton() { const wallet = useDya(); return <Button onClick={() => void wallet.connect()}>Connect wallet</Button>; }
