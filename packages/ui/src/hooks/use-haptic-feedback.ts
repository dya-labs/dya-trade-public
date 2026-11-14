"use client";

import { useCallback } from "react";
import { useWebHaptics } from "web-haptics/react";

/** Subtle, opt-in feedback for explicit mobile selections. Never blocks an action. */
export function useHapticFeedback() {
  const { trigger } = useWebHaptics({ debug: false, showSwitch: false });
  return useCallback((kind: "selection" | "light" | "success" | "error" = "selection") => {
    if (typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(max-width: 639px) and (pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Unsupported devices remain silent; a failed device API must not affect navigation.
    void trigger(kind)?.catch(() => {});
  }, [trigger]);
}
