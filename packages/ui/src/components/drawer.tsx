"use client";

import type { ComponentProps } from "react";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { XIcon } from "@dya/ui/icons";
import { Button } from "./button";
import { DialogFooter } from "./dialog";
import { cn } from "../lib/utils";

export const Drawer = DrawerPrimitive.Root;
export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerClose = DrawerPrimitive.Close;
export const DrawerTitle = DrawerPrimitive.Title;
export const DrawerDescription = DrawerPrimitive.Description;
export const DrawerPortal = DrawerPrimitive.Portal;
export { DialogHeader as DrawerHeader } from "./dialog";
export function DrawerFooter({className, ...props}: ComponentProps<typeof DialogFooter>) {
  return <DialogFooter {...props} className={cn(className, "rounded-b-none")}/>;
}

export function DrawerOverlay(props: ComponentProps<typeof DrawerPrimitive.Backdrop>) {
  return <DrawerPrimitive.Backdrop {...props} data-slot="drawer-overlay" className={cn("fixed inset-0 z-50 dya-overlay transition-opacity duration-200 data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none", props.className)}/>;
}

export function DrawerContent({ children, className, showCloseButton = true, ...props }: ComponentProps<typeof DrawerPrimitive.Popup> & { showCloseButton?: boolean }) {
  return <DrawerPrimitive.Portal>
    <DrawerOverlay/>
    <DrawerPrimitive.VirtualKeyboardProvider>
      <DrawerPrimitive.Viewport className="pointer-events-none fixed inset-x-0 top-0 bottom-[var(--drawer-keyboard-inset,0px)] z-50 flex items-end">
        <DrawerPrimitive.Popup {...props} data-slot="drawer-content" className={cn(
          "dya-drawer-popup pointer-events-auto grid max-h-[calc(100dvh-1rem)] min-h-0 gap-4 overflow-y-auto overscroll-contain border border-border bg-popover p-3 text-sm text-popover-foreground shadow-2xl shadow-black/30 outline-none",
          className,
          "max-h-[min(90dvh,calc(100%-1rem))] relative inset-x-auto top-auto bottom-auto left-auto w-full max-w-none translate-x-0 rounded-t-[var(--radius-dialog)] rounded-b-none pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        )}>
          <DrawerPrimitive.Content className="contents">{children}</DrawerPrimitive.Content>
          {showCloseButton && <DrawerPrimitive.Close render={<Button variant="ghost" size="icon-sm" className="absolute right-1 top-1 rounded-[max(0px,calc(var(--radius-dialog)-4px))]"/>}><XIcon/><span className="sr-only">Close</span></DrawerPrimitive.Close>}
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.VirtualKeyboardProvider>
  </DrawerPrimitive.Portal>;
}
