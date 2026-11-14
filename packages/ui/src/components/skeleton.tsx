"use client"

import { cn } from "@dya/ui/lib/utils"
import type { CSSProperties } from "react"
import { Skeleton as SkulletSkeleton, type SkeletonProps as SkulletSkeletonProps, SkeletonBox } from "skullet/react"

export type SkeletonProps<T = unknown> = SkulletSkeletonProps<T> & { id?: never }

/** Measure the rendered content; use sample data for its first loading state. */
function Skeleton<T>({ className, style, ...props }: SkeletonProps<T>) {
  // Empty id disables cross-visit shape storage, including balance titles/labels.
  return <SkulletSkeleton {...props} id="" className={cn("dya-skeleton", className)} style={{
    "--skullet-base": "color-mix(in oklab, var(--foreground) 8%, var(--muted))",
    "--skullet-highlight": "color-mix(in oklab, var(--foreground) 8%, transparent)",
    "--skullet-radius": "var(--radius-sm)",
    ...style,
  } as CSSProperties} />
}

export { Skeleton, Skeleton as MeasuredSkeleton }

/** Uniform cell placeholder; its width comes from the table column. */
export function SkeletonCell() {
  return <span aria-hidden="true" className="dya-cell-skeleton flex h-lh w-full items-center" style={{
    "--skullet-base": "color-mix(in oklab, var(--foreground) 8%, var(--muted))",
    "--skullet-highlight": "color-mix(in oklab, var(--foreground) 8%, transparent)",
  } as CSSProperties}><SkeletonBox width="100%" height="1em" radius="var(--radius-sm)" /></span>;
}
