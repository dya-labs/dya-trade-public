"use client";
import { useEffect, useState, type ComponentProps } from "react";
import { cn } from "@dya/ui/lib/utils";

/** Shared success geometry and stroke reveal used by toasts and progress indicators. */
export function SuccessMark({ complete, delay = 0, className, ...props }: ComponentProps<"svg"> & { complete: boolean; delay?: number }) {
  const [mounted, setMounted] = useState(false);
  const [reveal, setReveal] = useState({ complete, delay });
  if (complete !== reveal.complete) {
    setReveal({ complete, delay: complete ? delay : reveal.delay });
  }
  useEffect(() => { setMounted(true); }, []);
  return <svg {...props} aria-hidden="true" data-complete={complete} data-animate={mounted} style={{ "--success-mark-delay": `${reveal.delay}ms`, ...props.style } as React.CSSProperties} className={cn("dya-success-mark size-4", className)} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
    <path d="m8 12 3 3 5-6" pathLength="1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
