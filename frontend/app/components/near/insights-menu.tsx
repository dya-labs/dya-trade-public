"use client";
import { InsightsIcon } from "@dya/ui/icons";
import { formatNumber } from "@dya/ui/lib/format-number";

import { DEFAULT_PAIR, type CatalogAsset } from "@/lib/near/domain/catalog";
import { unreadInsightIds, markInsightsRead } from "@/lib/analysis/insight-read-state";
import { analysisStorage } from "@/lib/analysis/market-storage";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Badge } from "@dya/ui/components/badge";
import { Button } from "@dya/ui/components/button";
import { ScrollArea } from "@dya/ui/components/scroll-area";
import { formatRelativeTime } from "@/lib/format";
import { Info } from "@dya/ui/icons";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { DialogDrawer, DialogDrawerContent, DialogDrawerHeader, DialogDrawerTitle } from "@dya/ui/components/dialog-drawer";
import { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle } from "@dya/ui/components/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@dya/ui/components/tooltip";
import { ENTRY_PLAN_UPDATED_EVENT, readActiveEntryPlan } from "@/lib/analysis/entry-plan-storage";
import {
  readEntryAnalysisHistory,
  selectEntryAnalysis,
  SELECTED_ENTRY_ANALYSIS_KEY,
  type EntryAnalysisRecord,
} from "@/lib/analysis/entry-analysis-history";

function decision(record: EntryAnalysisRecord) {
  if (record.plan.profile === "WAIT") return "Wait";
  return record.plan.levels.some((level) => level.confirmation === "AT_ZONE")
    ? "Scale in"
    : "Entry plan";
}

function explanation(record: EntryAnalysisRecord) {
  const { regime, risk, evidence } = record.plan;
  return `${regime.toLowerCase()} regime · ${risk.toLowerCase()} risk · 4h momentum ${evidence.change20Percent >= 0 ? "+" : ""}${formatNumber(evidence.change20Percent, { intl: { minimumFractionDigits: 1, maximumFractionDigits: 1 } })}%`;
}

export function InsightsMenu({ asset = DEFAULT_PAIR.base, controls, headerAction, mobile = false, open: controlledOpen, onOpenChange }: { mobile?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; asset?: CatalogAsset; controls?: ReactNode; headerAction?: ReactNode }) {
  const assetId = asset.assetId;
  const [now, setNow] = useState(0);
  const [records, setRecords] = useState<EntryAnalysisRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next); };
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(() => {
    setNow(Date.now());
    try {
      const storage = analysisStorage(localStorage, assetId);
      const history = readEntryAnalysisHistory(storage);
      const active = history.length === 0 ? readActiveEntryPlan(storage) : null;
      const next = active ? [{ id: `legacy-${active.asOf}`, createdAt: active.asOf, trigger: "manual" as const, plan: active }] : history;
      const selected = storage.getItem(SELECTED_ENTRY_ANALYSIS_KEY);
      setRecords(next);
      setSelectedId(selected);
      setLoadFailed(false);
      setError("");
      const ids = next.map(record => record.id);
      if (open) {
        try { markInsightsRead(storage, ids); }
        catch { setError("Read status could not be saved in this browser."); }
        setUnreadCount(0);
      } else {
        setUnreadCount(unreadInsightIds(storage, ids).length);
      }
    } catch {
      setRecords([]);
      setUnreadCount(0);
      setLoadFailed(true);
      setError("Insights could not be loaded in this browser.");
    }
  }, [assetId, open]);

  useEffect(() => {
    const timer = window.setTimeout(refresh, 0);
    window.addEventListener(ENTRY_PLAN_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(ENTRY_PLAN_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [open]);

  function select(record: EntryAnalysisRecord) {
    try { selectEntryAnalysis(analysisStorage(localStorage, assetId), record.id); }
    catch { setError("This insight could not be selected. Try again."); return; }
    setSelectedId(record.id);
    window.dispatchEvent(new Event(ENTRY_PLAN_UPDATED_EVENT));
    setOpen(false);
  }

  const Root = mobile ? DialogDrawer : Popover;
  const Content = mobile ? DialogDrawerContent : PopoverContent;
  const Header = mobile ? DialogDrawerHeader : PopoverHeader;
  const Title = mobile ? DialogDrawerTitle : PopoverTitle;
  return (
    <Root open={open} onOpenChange={setOpen}>
      {!mobile && <PopoverTrigger render={<Button variant="outline" size="icon-sm" className="relative" aria-label={unreadCount ? `Insights, ${unreadCount} unread` : "Insights"} title="Insights" />}><InsightsIcon />{unreadCount > 0 && <span aria-hidden="true" className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />}</PopoverTrigger>}
      <Content {...(!mobile ? { align: "end" as const } : {})} className={mobile ? "max-h-[85dvh] overflow-y-auto" : "w-96 max-w-[calc(100vw-2rem)] p-4"}>
        <Header>
          <div className="flex items-center gap-2">
            <Title>Insights</Title>
            <Badge className="bg-primary/10 text-primary">Alpha</Badge>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="About Insights" />}><Info /></TooltipTrigger>
              <TooltipContent>{displaySymbol(asset)} / USDC · Experimental market analysis</TooltipContent>
            </Tooltip>
            {headerAction && <div className="ml-auto">{headerAction}</div>}
          </div>
        </Header>
          {controls}
          {error && <div role="alert" className="space-y-2 text-xs text-muted-foreground"><p>{error}</p>{loadFailed && <Button size="sm" variant="outline" onClick={refresh}>Retry</Button>}</div>}
          {records.length ? (
            <ScrollArea className="-mx-2 h-80 max-h-[60vh]">
              <div className="space-y-1 py-1">
                {records.map((record) => {
                  const selected = record.id === selectedId || (!selectedId && record === records[0]);
                  const peakProbability = Math.max(...record.plan.levels.map((level) => level.reactionProbability));
                  return (
                    <Button
                      key={record.id}
                      variant={selected ? "secondary" : "ghost"}
                      className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left transition-none hover:bg-hover hover:text-foreground focus-visible:bg-hover dark:hover:bg-hover"
                      aria-pressed={selected}
                      onClick={() => select(record)}
                    >
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="flex items-center justify-between gap-2">
                          <strong className="text-xs">{decision(record)}</strong>
                          <time className="text-[10px] text-muted-foreground" dateTime={new Date(record.createdAt).toISOString()} title={new Date(record.createdAt).toLocaleString()}>{formatRelativeTime(record.createdAt, now)}</time>
                        </span>
                        <span className="block text-[11px] font-normal text-muted-foreground">{explanation(record)}</span>
                        <span className="flex items-center justify-between gap-2 text-[10px] font-normal text-muted-foreground">
                          <span>{record.plan.levels.length} levels · peak p{Math.round(peakProbability * 100)}</span>
                          <Badge variant="outline" className="text-[9px]">{record.trigger}</Badge>
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            </ScrollArea>
          ) : !loadFailed && (
            <div className="flex h-full min-h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">No insights yet for this token. Use Refresh levels on the chart to generate an analysis.</div>
          )}
      </Content>
    </Root>
  );
}
