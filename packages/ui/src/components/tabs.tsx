"use client"

import { useLayoutEffect, useRef } from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@dya/ui/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-md p-1 text-muted-foreground group-data-horizontal/tabs:h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
        labels: "gap-4 rounded-none bg-transparent p-0 justify-start",
        side: "bg-control p-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  sideAppearance = "solid",
  ref,
  children,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants> & { sideAppearance?: "solid" | "soft" }) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)
  const animateNext = useRef(false)
  const initialized = useRef(false)

  useLayoutEffect(() => {
    if (variant !== "line" && variant !== "side") return
    const list = listRef.current
    const indicator = indicatorRef.current
    if (!list || !indicator) return
    const update = (animate = false) => {
      const active = list.querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-active]')
      if (!active) { indicator.style.opacity = "0"; return }
      const listBounds = list.getBoundingClientRect()
      const bounds = active.getBoundingClientRect()
      const targetX = bounds.left - listBounds.left + list.scrollLeft
      const targetWidth = bounds.width
      const baseWidth = variant === "side" ? parseFloat(indicator.style.width) || targetWidth : 1
      const matrix = typeof DOMMatrixReadOnly === "undefined"
        ? null
        : new DOMMatrixReadOnly(getComputedStyle(indicator).transform)
      const currentX = matrix?.m41 ?? targetX
      const currentWidth = (matrix?.m11 ?? (variant === "side" ? 1 : targetWidth)) * baseWidth
      const scale = (width: number) => width / (variant === "side" ? targetWidth : 1)
      const target = `translate3d(${targetX}px, 0, 0) scaleX(${scale(targetWidth)})`
      const sideColor = active.dataset.tone === "sell" ? "var(--market-down)" : "var(--market-up)"
      const targetColor = variant === "side"
        ? sideAppearance === "soft" ? `color-mix(in srgb, ${sideColor} 12%, transparent)` : sideColor
        : "var(--foreground)"
      const styles = getComputedStyle(list)
      const durationToken = styles.getPropertyValue("--motion-duration-tab").trim()
      const duration = durationToken
        ? parseFloat(durationToken) * (durationToken.endsWith("ms") ? 1 : 1000)
        : 180
      const easing = styles.getPropertyValue("--motion-ease-standard").trim() || "cubic-bezier(0.23, 1, 0.32, 1)"
      const maxStretch = parseFloat(styles.getPropertyValue("--motion-tab-stretch")) || 4
      indicator.getAnimations?.().forEach(animation => animation.cancel())
      if (variant === "side") indicator.style.width = `${targetWidth}px`
      indicator.style.transform = target
      indicator.style.backgroundColor = targetColor
      if (initialized.current && animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches && typeof indicator.animate === "function") {
        const distance = targetX - currentX
        const stretch = Math.min(maxStretch, Math.abs(distance) * 0.04)
        if (Math.abs(distance) > 1) {
          const middleX = currentX + distance * 0.55 - (distance < 0 ? stretch : 0)
          const middleWidth = currentWidth + (targetWidth - currentWidth) * 0.55 + stretch
          indicator.animate(
            [
              { transform: `translate3d(${currentX}px, 0, 0) scaleX(${scale(currentWidth)})`, offset: 0 },
              { transform: `translate3d(${middleX}px, 0, 0) scaleX(${scale(middleWidth)})`, offset: 0.48 },
              { transform: target, offset: 1 },
            ],
            { duration, easing }
          )
        }
      }
      indicator.style.opacity = "1"
      initialized.current = true
    }
    update()
    const mutations = new MutationObserver(() => {
      update(animateNext.current)
      animateNext.current = false
    })
    mutations.observe(list, { subtree: true, attributes: true, attributeFilter: ["data-active"] })
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => update())
    resize?.observe(list)
    list.querySelectorAll('[data-slot="tabs-trigger"]').forEach(tab => resize?.observe(tab))
    return () => { mutations.disconnect(); resize?.disconnect() }
  }, [variant, sideAppearance])

  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      ref={node => {
        listRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      }}
      onPointerDownCapture={() => { animateNext.current = true }}
      onKeyDownCapture={() => { animateNext.current = false }}
      className={cn(tabsListVariants({ variant }), (variant === "line" || variant === "side") && "tab-sliding-list relative", className)}
      {...props}
    >
      {children}
      {(variant === "line" || variant === "side") && <span ref={indicatorRef} className="tab-sliding-indicator" aria-hidden="true" />}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-2 rounded-sm border border-transparent px-2.5 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "group-data-[variant=side]/tabs-list:z-10 group-data-[variant=side]/tabs-list:bg-transparent group-data-[variant=side]/tabs-list:data-active:border-transparent group-data-[variant=side]/tabs-list:data-active:bg-transparent group-data-[variant=side]/tabs-list:data-active:shadow-none dark:group-data-[variant=side]/tabs-list:data-active:border-transparent dark:group-data-[variant=side]/tabs-list:data-active:bg-transparent",
        "group-data-[variant=labels]/tabs-list:flex-none group-data-[variant=labels]/tabs-list:rounded-none group-data-[variant=labels]/tabs-list:border-transparent group-data-[variant=labels]/tabs-list:px-0 group-data-[variant=labels]/tabs-list:text-muted-foreground group-data-[variant=labels]/tabs-list:bg-transparent group-data-[variant=labels]/tabs-list:data-active:bg-transparent group-data-[variant=labels]/tabs-list:data-active:text-foreground group-data-[variant=labels]/tabs-list:data-active:shadow-none dark:group-data-[variant=labels]/tabs-list:data-active:border-transparent dark:group-data-[variant=labels]/tabs-list:data-active:bg-transparent group-data-[variant=labels]/tabs-list:after:hidden",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-px group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-px group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
