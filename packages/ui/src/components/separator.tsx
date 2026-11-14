"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import type { ComponentProps } from "react"
import { cn } from "@dya/ui/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

function LabeledSeparator({ children, className, ...props }: ComponentProps<"div">) {
  return <div data-slot="labeled-separator" className={cn("flex items-center gap-3", className)} {...props}>
    <Separator className="min-w-0 flex-1" />
    <span className="shrink-0 text-xs text-muted-foreground">{children}</span>
    <Separator className="min-w-0 flex-1" />
  </div>
}

export { Separator, LabeledSeparator }
