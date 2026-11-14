"use client";
import { RefreshCw } from "@dya/ui/icons";
import { Button } from "@dya/ui/components/button";
import { Switch } from "@dya/ui/components/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@dya/ui/components/tooltip";
import type { useChartAnalysis } from "./use-chart-analysis";

export function JevSettings({ analysis, showLevels, onShowLevelsChange }: {
  analysis: ReturnType<typeof useChartAnalysis>;
  showLevels: boolean; onShowLevelsChange: (show: boolean) => void;
}) {
  return <div className="space-y-3 border-b pb-4 text-xs">
    <div className="flex items-center justify-between gap-4"><span>Show chart levels</span><Switch size="sm" checked={showLevels} onCheckedChange={onShowLevelsChange} aria-label="Show chart levels" /></div>
    {analysis.analysisMessage && <p role="status" className="text-muted-foreground">{analysis.analysisMessage}</p>}
  </div>;
}

export function JevRefresh({ enabled, analysis }: { enabled: boolean; analysis: ReturnType<typeof useChartAnalysis> }) {
  return <Tooltip><TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label={analysis.analyzing ? "Refreshing levels" : "Refresh levels"} disabled={analysis.analyzing || !enabled} onClick={() => void analysis.drawEntryLevels()} />}><RefreshCw className={analysis.analyzing ? "animate-spin" : undefined} /></TooltipTrigger><TooltipContent>Refresh levels</TooltipContent></Tooltip>;
}
