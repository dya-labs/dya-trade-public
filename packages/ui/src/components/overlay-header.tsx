"use client"

import type { ComponentProps, ReactNode } from "react"
import { Button } from "@dya/ui/components/button"
import { ArrowLeft } from "@dya/ui/icons"
import { cn } from "@dya/ui/lib/utils"

export const overlayTitleClassName = "font-heading text-base leading-none font-medium"
export type OverlayHeaderProps = ComponentProps<"div"> & {
  action?: ReactNode
  onBack?: () => void
  backDisabled?: boolean
  backLabel?: string
}

/** Shared visual layout; the owning dialog/popover provides accessible titles. */
export function OverlayHeader({ className, children, action, onBack, backDisabled = false, backLabel = "Back", ...props }: OverlayHeaderProps) {
  return <div className={cn("relative flex min-h-11 flex-col justify-center gap-1 border-b border-border p-3 pr-12", onBack && "items-center pl-12 text-center", className)} {...props}>
    {onBack && <Button type="button" variant="ghost" size="icon-sm" className="absolute top-1 left-1 rounded-[max(0px,calc(var(--radius-dialog)-4px))]" aria-label={backLabel} disabled={backDisabled} onClick={onBack}><ArrowLeft /></Button>}
    {action && <div className="absolute top-1 right-1 [&_[data-slot=button]]:rounded-[max(0px,calc(var(--radius-dialog)-4px))]">{action}</div>}
    {children}
  </div>
}
