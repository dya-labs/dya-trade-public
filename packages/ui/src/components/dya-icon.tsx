import type { ComponentProps } from "react";
import { BRAND_MARK } from "../brand/mark.js";

/** Icon-sized Dya mark. Geometry stays canonical; size and color follow the caller. */
export function DyaIcon(props: ComponentProps<"svg">) {
  return <svg viewBox={BRAND_MARK.viewBox} width={24} height={24} fill="currentColor" aria-hidden="true" {...props}>
    <path d={BRAND_MARK.path}/>
  </svg>;
}
