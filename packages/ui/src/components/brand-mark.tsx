import { useId, type SVGProps } from "react";
import { BRAND_MARK } from "../brand/mark.js";
/** Shared brand geometry; supply a label when the surrounding link does not name it. */
export function BrandMark({ label, ...props }: SVGProps<SVGSVGElement> & { label?: string }) {
  const titleId = useId();
  return <svg viewBox={BRAND_MARK.viewBox} width={BRAND_MARK.width} height={BRAND_MARK.height} fill="none" role={label ? "img" : undefined} aria-hidden={label ? undefined : true} aria-labelledby={label ? titleId : undefined} {...props}>{label && <title id={titleId}>{label}</title>}<path d={BRAND_MARK.path} fill={BRAND_MARK.color}/></svg>;
}
