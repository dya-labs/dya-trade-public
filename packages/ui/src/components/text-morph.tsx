"use client";

import { TextMorph as TorphTextMorph, type TextMorphProps as TorphTextMorphProps } from "torph/react";

export type TextMorphProps = Omit<TorphTextMorphProps, "children" | "respectReducedMotion"> & {
  children: string | number;
};

/** Shared Torph defaults. Keep the same instance mounted as its text changes. */
export function TextMorph({ duration = 300, ease = "cubic-bezier(0.16, 1, 0.3, 1)", ...props }: TextMorphProps) {
  return <TorphTextMorph {...props} duration={duration} ease={ease} respectReducedMotion />;
}
