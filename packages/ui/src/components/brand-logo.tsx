import type { ComponentProps } from "react";
import { BrandMark } from "@dya/ui/components/brand-mark";
import { cn } from "@dya/ui/lib/utils";

type BrandLogoProps = Omit<ComponentProps<"span">, "children"> & {
  /** Mark height and name font size, in pixels. */
  size?: number;
  name: string;
  nameClassName?: string;
};

/** Shared lockup: scale the mark, name and spacing together. */
export function BrandLogo({ size = 14, name, nameClassName, className, style, ...props }: BrandLogoProps) {
  return <span {...props} className={cn("inline-flex shrink-0 items-center", className)} style={{ ...style, gap: Math.round(size * 3 / 7), fontSize: size }}>
    <BrandMark className="shrink-0" style={{ height: size, width: "auto" }} />
    <span className={cn("font-medium tracking-tight", nameClassName)}>{name}</span>
  </span>;
}
