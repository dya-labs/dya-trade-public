"use client";

import { useRef, type ComponentProps } from "react";
import { flushSync } from "react-dom";
import { useHapticFeedback } from "../hooks/use-haptic-feedback";

import { NavigationIcon, type NavigationIconName } from "./navigation-icon";

export function AnimatedNavLink({ icon, children, onClick, ...props }: ComponentProps<"a"> & { icon: NavigationIconName }) {
  const svg = useRef<SVGSVGElement>(null);
  const selectionFeedback = useHapticFeedback();
  return <a {...props} onClick={event => {
    // Markets replaces outlined bars with mask cutouts when selected.
    // Commit that change before targeting the live SVG nodes for animation.
    if (icon === "markets") flushSync(() => onClick?.(event));
    else onClick?.(event);
    if (event.defaultPrevented || event.detail === 0) return;
    selectionFeedback();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if ((icon === "portfolio" || icon === "trade") && svg.current) {
      const mark = svg.current;
      const current = getComputedStyle(mark).transform;
      mark.getAnimations().forEach(animation => animation.cancel());
      mark.style.transformOrigin = "center";
      mark.style.transformBox = "view-box";
      if (icon === "trade") {
        const matrix = current.match(/^matrix\(([^)]+)\)$/)?.[1].split(",").map(Number);
        const angle = matrix ? (Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI + 360) % 360 : 0;
        // Inactive Trade rests at 180 degrees; selection settles upright.
        mark.animate([{ transform: current === "none" ? "rotate(0deg)" : `rotate(${angle > 180 ? angle - 360 : angle}deg)` }, { transform: "rotate(0deg)" }], {
          duration: 900, easing: "cubic-bezier(0.23, 1, 0.32, 1)", iterations: 1,
        });
      } else {
        mark.animate([
          { transform: current === "none" ? "scale(1)" : current },
          { transform: "scale(0.85)", offset: 0.4 },
          { transform: "scale(1)" },
        ], { duration: 900, easing: "cubic-bezier(0.23, 1, 0.32, 1)", iterations: 1 });
      }
      return;
    }
    svg.current?.querySelectorAll<SVGPathElement>("[data-animate-bar]").forEach((part, index) => {
      // Replay the left-to-right reveal on each explicit click.
      part.getAnimations().forEach(animation => animation.cancel());
      if (icon === "markets") {
        part.style.transformBox = "fill-box";
        part.style.transformOrigin = "center bottom";
        part.animate([
          { transform: "scaleY(0)" },
          { transform: "scaleY(1)" },
        ], { duration: 900, delay: index * 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)", iterations: 1, fill: "backwards" });
        return;
      }

    });
  }}><NavigationIcon ref={svg} icon={icon} active={props["aria-current"] === "page"} className="size-[22px] shrink-0 overflow-visible"/>{children}</a>;
}
