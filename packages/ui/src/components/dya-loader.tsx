import { BRAND_MARK } from "../brand/mark.js";
import { useEffect, useId, useRef, type ComponentProps } from "react";
import { cn } from "@dya/ui/lib/utils";

/** The current logo's green branches, revealed from the stem up and out along both branches. */
export function DyaLoader({ className, label = "Loading", loop = true, ...props }: Omit<ComponentProps<"span">, "children"> & { label?: string; loop?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const traces = [...svg.querySelectorAll<SVGPathElement>(".dya-loader-trace")];
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let start: number | undefined;
    const paint = (progress: number, opacity = 1) => {
      traces.forEach(trace => trace.setAttribute("stroke-dashoffset", String(300 * (1 - progress))));
      svg.style.opacity = String(opacity);
    };
    const tick = (now: number) => {
      start ??= now;
      const duration = loop ? 2200 : 1300;
      const elapsed = now - start;
      const position = loop ? elapsed % duration / duration : Math.min(1, elapsed / duration);
      const progress = Math.min(1, Math.max(0, (position - .05) / .60));
      paint(progress * progress * (3 - 2 * progress), loop ? Math.min(1, Math.max(0, (1 - position) / .16)) : 1);
      if (loop || position < 1) frame = requestAnimationFrame(tick);
    };
    const update = () => {
      cancelAnimationFrame(frame);
      if (media?.matches) paint(1);
      else { start = undefined; paint(0); frame = requestAnimationFrame(tick); }
    };
    update();
    media?.addEventListener?.("change", update);
    return () => { cancelAnimationFrame(frame); media?.removeEventListener?.("change", update); };
  }, [loop]);
  const maskId = `dya-loader-${useId().replaceAll(":", "")}`;
  return <span role="status" aria-label={label} className={cn("inline-flex w-14 items-center justify-center", className)} {...props}>
    <svg ref={ref} viewBox={BRAND_MARK.viewBox} fill="none" data-loop={loop} className="dya-loader-mark block h-auto w-full" aria-hidden="true">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" style={{ maskType: "luminance" }} x="22.1221" y="96" width="271.3219" height="149">
          <g fill="none" stroke="white" strokeWidth="38" strokeLinecap="round" strokeLinejoin="round">
            <path className="dya-loader-trace" strokeDasharray="300 300" strokeDashoffset="300" d="M158 250 L158 175 C158 130 185 108 225 108 H300" />
            <path className="dya-loader-trace" strokeDasharray="300 300" strokeDashoffset="300" d="M158 250 L158 175 C158 130 131 108 91 108 H16" />
          </g>
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
      <path d={BRAND_MARK.path} fill="currentColor" />
      </g>
    </svg>
    <span className="sr-only">{label}</span>
  </span>;
}
