import { isStoredEntryPlan } from "./entry-plan-schema";
import type { EntryPlan } from "@/lib/analysis/entry-analysis";

export const ENTRY_PLAN_STORAGE_KEY = "nervana:near-entry-plan";
export const ENTRY_PLAN_UPDATED_EVENT = "nervana:near-entry-plan-updated";


export function readActiveEntryPlan(
  storage: Pick<Storage, "getItem" | "removeItem">,
  now = Date.now(),
): EntryPlan | null {
  try {
    const raw = storage.getItem(ENTRY_PLAN_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredEntryPlan(parsed) || parsed.expiresAt <= now) {
      storage.removeItem(ENTRY_PLAN_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(ENTRY_PLAN_STORAGE_KEY);
    return null;
  }
}

export function storeEntryPlan(
  storage: Pick<Storage, "setItem" | "removeItem">,
  plan: EntryPlan,
) {
  storage.setItem(ENTRY_PLAN_STORAGE_KEY, JSON.stringify(plan));
}
