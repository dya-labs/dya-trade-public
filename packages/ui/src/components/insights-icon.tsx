import type { ComponentProps } from "react";
import { BRAND_MARK } from "@dya/ui/brand";

/** Custom interface icon for Insights; inherits size and color from its control. */
export function InsightsIcon(props: ComponentProps<"svg">) {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M12 1.25L15.75 5L12 8.75L8.25 5Z"/>
    <svg x="2" y="11" width="20" height="11" viewBox={BRAND_MARK.viewBox}>
      <path d={BRAND_MARK.path}/>
    </svg>
  </svg>;
}
