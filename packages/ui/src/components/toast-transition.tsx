"use client";
import type { ReactNode } from "react";
import { TextMorph } from "./text-morph";
import { LoaderCircle } from "@dya/ui/icons";
import { SuccessMark } from "./success-mark";
type Outcome = "success" | "error";
export function ToastTransitionIcon({ complete, outcome = "success", size = "sm" }: { complete: boolean; outcome?: Outcome; size?: "sm" | "lg" }) {
  return <span className="toast-transition-icon" data-size={size} data-complete={complete} data-outcome={outcome} aria-hidden="true">
    <span className="toast-transition-spinner"><LoaderCircle className="size-full [&_circle]:[stroke-width:2.5]" /></span>
    {outcome === "success" ? <SuccessMark complete={complete} delay={100} className="toast-transition-success absolute" /> : <svg className="toast-transition-check" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />{outcome === "error" ? <><path d="m9 9 6 6" pathLength="1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><path className="toast-error-second-stroke" d="m15 9-6 6" pathLength="1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></> : <path d="m8 12 3 3 5-6" pathLength="1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}</svg>}
  </span>;
}
// Keep the same component mounted through loading updates and their result.
// Rich React content remains intact instead of being flattened into text.
export function ToastTransitionMessage({ current }: { current: ReactNode }) {
  return typeof current === "string" || typeof current === "number"
    ? <TextMorph className="toast-transition-message" numbers={false}>{current}</TextMorph>
    : <>{current}</>;
}
