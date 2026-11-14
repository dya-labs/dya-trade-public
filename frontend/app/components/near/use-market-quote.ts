"use client";
import { previewMarketOrder } from "@/lib/near/http/trading-client";
import { ticketErrorCode } from "./order-ticket-errors";
import type { ErrorCode } from "@/lib/near/domain/errors";
import { useEffect, useState } from "react";
import type { SlippageSettings, MarketPreview } from "@/lib/near/http/schemas/trading";
import { affordableBuyQuantity } from "@/lib/near/domain/order-size";

export const MARKET_QUOTE_DEBOUNCE_MS = 300;

/** One reference for every quote of an input, in the wallet server's format: 32 random bytes, base64url. */
function quoteReference() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

type Args = { suspended?: boolean; quoteAmount?: string; slippage?: SlippageSettings; baseAssetId?: string; quoteAssetId?: string; decimals?: number; quoteKey: string; side: "buy" | "sell"; quantity: string; sizePercent: number; available?: string; isSliding: boolean; quoteDelay: number; onAffordableSize: (quantity: string) => void };
export function useMarketQuote({ suspended = false, quoteAmount, slippage, baseAssetId, quoteAssetId, decimals, quoteKey, side, quantity, sizePercent, available, isSliding, quoteDelay, onAffordableSize }: Args) {
  const slippageMode = slippage?.mode;
  const slippageBps = slippage?.mode === "custom" ? slippage.bps : undefined;
  // A balance refresh or budget change can leave the token quantity unchanged.
  // Quotes and errors belong to those sizing inputs as well as the market/size.
  const contextKey = JSON.stringify([quoteAmount, slippage, quoteKey, baseAssetId, quoteAssetId, decimals, side, quantity, sizePercent, available]);
  const [retryKey, setRetryKey] = useState(0);
  const retryQuote = () => { setFailure(null); setRetryKey(value => value + 1); };
  const [indicative, setIndicative] = useState<{ key: string; quote: MarketPreview } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string; code?: ErrorCode } | null>(null);
  useEffect(() => {
    if (!quoteKey || isSliding || suspended) return;
    const controller = new AbortController();
    const debounceStarted = performance.now();
    let requested = false;
    const report = (mode: "quick" | "full" | "refresh" | "debounce", outcome: "success" | "error" | "aborted" | "resized", scheduledAt: number, requestStarted?: number) => {
      const now = performance.now();
      console.debug("trading.quote.browser", JSON.stringify({ mode, outcome, debounceMs: Math.round((requestStarted ?? now) - scheduledAt), requestMs: requestStarted === undefined ? 0 : Math.round(now - requestStarted), totalMs: Math.round(now - scheduledAt) }));
    };
    let timer: ReturnType<typeof setTimeout>;
    // Each new input requests two quotes together under one reference: a quick one (short solver
    // window), shown as soon as it arrives, and a full-window one that replaces it; later refreshes
    // use the full window. Review reuses whichever the server holds under the reference.
    const reference = quoteReference();
    let shown: "quick" | "full" | undefined;
    let quickPending = true;
    let resized = false;
    // A full-window failure is held back while the quick quote may still arrive.
    let fullFailure: { cause: unknown } | undefined;
    const fail = (cause: unknown) => { setIndicative(null); setFailure({ key: contextKey, code: ticketErrorCode(cause), message: cause instanceof Error ? cause.message : "Indicative quote unavailable" }); };
    async function poll(mode: "quick" | "full" | "refresh", scheduledAt: number) {
      const requestStarted = performance.now();
      requested = true;
      try {
        const quote = await previewMarketOrder({ slippage: slippageMode === "custom" ? { mode: "custom", bps: slippageBps! } : slippageMode === "default" ? { mode: "default" } : undefined, side, quantity, ...(quoteAmount !== undefined ? { quoteAmount } : {}), baseAssetId, quoteAssetId, quoteReference: reference }, controller.signal, mode === "quick");
        if (controller.signal.aborted) { report(mode, "aborted", scheduledAt, requestStarted); return; }
        if (mode === "quick") quickPending = false;
        const next = quoteAmount === undefined && side === "buy" && sizePercent > 0 && available
          ? affordableBuyQuantity({ quantity, available, quotedInput: quote.principal, decimals, percent: sizePercent }) : "";
        report(mode, next ? "resized" : "success", scheduledAt, requestStarted);
        // The first quote that asks for a smaller size restarts this input; the full quote outlives the quick one.
        if (resized || (mode === "quick" && shown === "full")) return;
        if (next) { resized = true; onAffordableSize(next); }
        else { setIndicative({ key: contextKey, quote }); shown = mode === "quick" ? "quick" : "full"; }
        setFailure(null);
      } catch (cause) {
        report(mode, controller.signal.aborted ? "aborted" : "error", scheduledAt, requestStarted);
        if (controller.signal.aborted) return;
        // A quick quote can miss solvers the full window reaches, and a failed full quote keeps the
        // quick one it would have replaced: only full-window failures without a quote are shown.
        if (mode === "refresh") fail(cause);
        else if (mode === "quick") { quickPending = false; if (fullFailure) fail(fullFailure.cause); }
        else if (quickPending) fullFailure = { cause };
        else if (!shown && !resized) fail(cause);
      } finally {
        if (mode !== "quick" && !controller.signal.aborted) timer = setTimeout(() => void poll("refresh", performance.now()), 30_000);
      }
    }
    timer = setTimeout(() => { void poll("quick", debounceStarted); void poll("full", debounceStarted); }, quoteDelay);
    return () => { if (!requested) report("debounce", "aborted", debounceStarted); controller.abort(); clearTimeout(timer); };
  }, [suspended, quoteAmount, slippageMode, slippageBps, contextKey, baseAssetId, quoteAssetId, decimals, quoteKey, side, quantity, sizePercent, available, isSliding, quoteDelay, onAffordableSize, retryKey]);
  return { currentQuoteErrorCode: failure?.key === contextKey ? failure.code : undefined, retryQuote, currentQuote: indicative?.key === contextKey ? indicative.quote : null, currentQuoteError: failure?.key === contextKey ? failure.message : "" };
}
