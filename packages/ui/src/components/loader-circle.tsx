import type { ComponentProps } from "react";
import { cn } from "@dya/ui/lib/utils";

/** Indeterminate progress: the arc grows and trails as it travels around the ring. */
export function LoaderCircle(props: ComponentProps<"svg">) {
  const { className, ...rest } = props;
  return <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn("dya-spinner", className)} {...rest}>
    <g className="dya-spinner-orbit">
      <circle className="dya-spinner-arc" cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" strokeLinecap="butt" strokeDasharray="12.566 37.699"/>
    </g>
  </svg>;
}
