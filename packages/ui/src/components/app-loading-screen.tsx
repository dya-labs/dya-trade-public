"use client";
import { useEffect, useState } from "react";
import { LoadingArtwork } from "./loading-artwork";
import { DyaLoader } from "@dya/ui/components/dya-loader";

const EXIT_MS = 200;
/** Fade the shared overlay away as soon as the page is ready. */
export function AppLoadingScreen({ active, label = "Loading app", onExitComplete }: { active: boolean; label?: string; onExitComplete?: () => void }) {
  const [visible, setVisible] = useState(active);
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const update = () => setReduced(media.matches);
    update(); media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  useEffect(() => { if (active) setVisible(true); }, [active]);
  const exiting = visible && !active;
  useEffect(() => {
    if (!visible && !active) { onExitComplete?.(); return; }
    if (!exiting) return;
    if (reduced) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [visible, active, exiting, reduced, onExitComplete]);
  if (!active && !visible) return null;
  return <div className="app-loading-screen fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-background" data-active={!exiting} data-phase={exiting ? "exit" : "hold"} aria-hidden={exiting || undefined}>
    <LoadingArtwork/>
    <DyaLoader loop={false} label={label} className="relative w-24 sm:w-32"/>
  </div>;
}
