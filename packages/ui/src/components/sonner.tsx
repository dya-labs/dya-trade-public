"use client"

import { buttonVariants } from "@dya/ui/components/button"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, LoaderCircle } from "@dya/ui/icons"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <span className="flex size-5 items-center justify-center rounded-full bg-success text-foreground"><CircleCheckIcon className="size-4" /></span>
        ),
        info: (
          <span className="flex size-5 items-center justify-center rounded-full bg-info text-foreground"><InfoIcon className="size-4" /></span>
        ),
        warning: (
          <span className="flex size-5 items-center justify-center rounded-full bg-warning text-foreground"><TriangleAlertIcon className="size-4 -translate-y-px" /></span>
        ),
        error: (
          <span className="flex size-5 items-center justify-center rounded-full bg-destructive text-foreground"><OctagonXIcon className="size-4" /></span>
        ),
        loading: (
          <span className="flex size-5 items-center justify-center rounded-full bg-foreground/10 text-foreground"><LoaderCircle className="size-4 [&_circle]:[stroke-width:2.5]" /></span>
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-dialog)",
        } as React.CSSProperties
      }
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "cn-toast flex w-[var(--width)] items-center gap-2 rounded-[var(--radius-dialog)] border border-border bg-popover p-3 font-sans text-[13px] text-popover-foreground shadow-lg shadow-black/15 dark:shadow-black/25 [&:has([data-close-button])]:pr-11",
          content: "flex min-w-0 flex-1 flex-col gap-1",
          title: "font-medium leading-5",
          description: "text-xs leading-5 text-muted-foreground!",
          icon: "relative flex size-5 shrink-0 items-center justify-center [&_svg]:size-4",
          actionButton: `${buttonVariants({ variant: "link", size: "xs" })} px-1`,
          cancelButton: buttonVariants({ variant: "ghost", size: "xs" }),
          closeButton: `${buttonVariants({ variant: "ghost", size: "icon-xs" })} absolute right-2 top-2`,
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
