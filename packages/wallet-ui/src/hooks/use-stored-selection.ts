"use client";
import { useCallback, useSyncExternalStore } from "react";

// Selections whose storage write failed; they last for this page load only.
const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
}

function read(key: string) {
  if (memory.has(key)) return memory.get(key)!;
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * A string kept in localStorage under `key`, shared by every reader and other tabs.
 * It reads null on the server, without a key, and when nothing is stored.
 */
export function useStoredSelection(key: string | null): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(subscribe, () => key ? read(key) : null, () => null);
  const select = useCallback((next: string | null) => {
    if (!key) return;
    try {
      if (next === null) localStorage.removeItem(key);
      else localStorage.setItem(key, next);
      memory.delete(key);
    } catch { memory.set(key, next); }
    listeners.forEach(listener => listener());
  }, [key]);
  return [value, select];
}
