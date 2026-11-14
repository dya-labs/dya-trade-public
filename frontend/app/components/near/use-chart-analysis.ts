"use client";
import { analysisStorage } from "@/lib/analysis/market-storage";
import { analyzeEntry } from "@/lib/near/http/market-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EntryPlan } from "@/lib/analysis/entry-analysis";
import { ENTRY_PLAN_UPDATED_EVENT } from "@/lib/analysis/entry-plan-storage";
import { readDisplayedEntryPlan, storeEntryAnalysis } from "@/lib/analysis/entry-analysis-history";

export function useChartAnalysis(assetId: string, enabled = true) {
  const pending = useRef<AbortController | null>(null);
  const unsavedPlan = useRef<{ assetId: string; plan: EntryPlan } | null>(null);
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, [assetId, enabled]);
  const [planState, setPlanState] = useState<{ assetId: string; plan: EntryPlan | null }>({ assetId, plan: null });
  const setEntryPlan = useCallback((plan: EntryPlan | null) => setPlanState({ assetId, plan }), [assetId]);
  const entryPlan = planState.assetId === assetId ? planState.plan : null;
  const [request, setRequest] = useState<{ assetId: string; controller: AbortController } | null>(null);
  const analyzing = enabled && request?.assetId === assetId && !request.controller.signal.aborted;
  const [feedback, setFeedback] = useState({ assetId, message: "" });
  const setAnalysisMessage = useCallback((message: string) => setFeedback({ assetId, message }), [assetId]);
  const analysisMessage = feedback.assetId === assetId ? feedback.message : "";
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      try {
        const unsaved = unsavedPlan.current;
        setEntryPlan(unsaved?.assetId === assetId && unsaved.plan.expiresAt > Date.now()
          ? unsaved.plan : readDisplayedEntryPlan(analysisStorage(localStorage, assetId)));
      }
      catch { setAnalysisMessage("Saved analysis could not be loaded in this browser."); }
    };
    refresh();
    window.addEventListener(ENTRY_PLAN_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      window.removeEventListener(ENTRY_PLAN_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.clearInterval(timer);
    };
  }, [assetId, enabled, setEntryPlan, setAnalysisMessage]);
  const drawEntryLevels = useCallback(async () => {
    if (!enabled || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setRequest({ assetId, controller });
    setAnalysisMessage("");
    try {
      const next = await analyzeEntry(assetId, controller.signal);
      if (controller.signal.aborted) return;
      if (next.market?.assetId !== assetId) throw new Error("Analysis returned a different market");
      let saved = false;
      try {
        storeEntryAnalysis(analysisStorage(localStorage, assetId), next, "manual");
        saved = true;
      } catch { /* Current results remain available without browser persistence. */ }
      unsavedPlan.current = saved ? null : { assetId, plan: next };
      setEntryPlan(next);
      if (saved) window.dispatchEvent(new Event(ENTRY_PLAN_UPDATED_EVENT));
      if (!saved) setAnalysisMessage("Analysis is available, but could not be saved in this browser.");
      else if (next.profile === "WAIT")
        setAnalysisMessage(
          "Jev suggests waiting. Candidate support levels are shown as 0% watch levels.",
        );
    } catch (cause) {
      if (controller.signal.aborted) return;
      setAnalysisMessage(
        cause instanceof Error ? cause.message : "Entry analysis unavailable",
      );
    } finally {
      if (pending.current === controller) { pending.current = null; setRequest(null); }
    }
  }, [assetId, enabled, setEntryPlan, setAnalysisMessage]);
  return { entryPlan, analyzing, analysisMessage, drawEntryLevels };
}
