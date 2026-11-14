import { isStoredEntryPlan, storedDate } from "./entry-plan-schema";
import type { EntryPlan } from "@/lib/analysis/entry-analysis";
import { readActiveEntryPlan, storeEntryPlan } from "@/lib/analysis/entry-plan-storage";

export const ENTRY_ANALYSIS_HISTORY_KEY = "nervana:near-entry-analysis-history";
export const SELECTED_ENTRY_ANALYSIS_KEY = "nervana:selected-entry-analysis";
export const ENTRY_ANALYSIS_HISTORY_LIMIT = 20;

export type EntryAnalysisTrigger = "manual" | "auto";

export type EntryAnalysisRecord = {
  id: string;
  createdAt: number;
  trigger: EntryAnalysisTrigger;
  plan: EntryPlan;
};

function isRecord(value: unknown): value is EntryAnalysisRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<EntryAnalysisRecord>;
  return (
    typeof record.id === "string" &&
    storedDate.safeParse(record.createdAt).success &&
    (record.trigger === "manual" || record.trigger === "auto") &&
    isStoredEntryPlan(record.plan)
  );
}

export function readEntryAnalysisHistory(
  storage: Pick<Storage, "getItem" | "removeItem">,
): EntryAnalysisRecord[] {
  try {
    const raw = storage.getItem(ENTRY_ANALYSIS_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Invalid analysis history");
    return parsed.filter(isRecord).slice(0, ENTRY_ANALYSIS_HISTORY_LIMIT);
  } catch {
    storage.removeItem(ENTRY_ANALYSIS_HISTORY_KEY);
    return [];
  }
}

export function storeEntryAnalysis(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  plan: EntryPlan,
  trigger: EntryAnalysisTrigger,
  createdAt = Date.now(),
) {
  storeEntryPlan(storage, plan);
  const record: EntryAnalysisRecord = {
    id: `${plan.asOf}-${createdAt}`,
    createdAt,
    trigger,
    plan,
  };
  const history = [record, ...readEntryAnalysisHistory(storage)].slice(
    0,
    ENTRY_ANALYSIS_HISTORY_LIMIT,
  );
  storage.setItem(ENTRY_ANALYSIS_HISTORY_KEY, JSON.stringify(history));
  storage.setItem(SELECTED_ENTRY_ANALYSIS_KEY, record.id);
  return record;
}

export function selectEntryAnalysis(
  storage: Pick<Storage, "setItem">,
  id: string,
) {
  storage.setItem(SELECTED_ENTRY_ANALYSIS_KEY, id);
}

export function readDisplayedEntryPlan(
  storage: Pick<Storage, "getItem" | "removeItem">,
  now = Date.now(),
) {
  const selectedId = storage.getItem(SELECTED_ENTRY_ANALYSIS_KEY);
  const selected = readEntryAnalysisHistory(storage).find(
    (record) => record.id === selectedId,
  );
  return selected?.plan ?? readActiveEntryPlan(storage, now);
}
