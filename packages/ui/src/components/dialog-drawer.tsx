"use client";

import { createContext, useContext, useEffect, useCallback, useState, useSyncExternalStore, type ComponentProps, type ReactNode, type ReactElement, type CSSProperties } from "react";
import { Dialog, DialogContent, DialogTrigger, DialogClose, DialogTitle, DialogDescription, DialogHeader, DialogFooter } from "./dialog";
import { cn } from "../lib/utils";
import { Drawer, DrawerContent, DrawerTrigger, DrawerClose } from "./drawer";

const Presentation = createContext(false);
const query = "(max-width: 639px)";
const subscribe = (notify: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(query);
  media.addEventListener?.("change", notify);
  return () => media.removeEventListener?.("change", notify);
};
const snapshot = () => typeof window.matchMedia === "function" && window.matchMedia(query).matches;
const subscribeHydration = () => () => {};

type ChangeDetails = Parameters<NonNullable<ComponentProps<typeof Drawer>["onOpenChange"]>>[1];
type Props = Pick<ComponentProps<typeof Dialog>, "open" | "defaultOpen" | "modal" | "disablePointerDismissal" | "onOpenChangeComplete"> & {
  children: ReactNode;
  dismissible?: boolean;
  onOpenChange?: (open: boolean, details: ChangeDetails) => void;
};

/** Shared breakpoint locking for dialog and confirmation presentations. */
export function useDialogDrawerPresentation(open: boolean) {
  const mobile = useSyncExternalStore(subscribe, snapshot, () => false);
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const [lockedMobile, setLockedMobile] = useState<boolean | null>(null);
  const useDrawer = lockedMobile ?? mobile;
  useEffect(() => {
    if (open && hydrated && lockedMobile === null) setLockedMobile(mobile);
  }, [open, mobile, hydrated, lockedMobile]);
  const finishClose = useCallback(() => setLockedMobile(null), []);
  return { useDrawer, finishClose };
}

/** Adaptive presentation is locked while open, preserving form state across viewport changes. */
export function DialogDrawer({ children, open: controlledOpen, defaultOpen = false, onOpenChange, dismissible = true, ...props }: Props) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const { useDrawer, finishClose } = useDialogDrawerPresentation(open);
  const change = (next: boolean, details: ChangeDetails) => {
    if (!next && !dismissible) { details.cancel(); return; }
    onOpenChange?.(next, details);
    if (!details.isCanceled) setLocalOpen(next);
  };
  const Root = useDrawer ? Drawer : Dialog;
  return <Presentation.Provider value={useDrawer}><Root {...props} onOpenChangeComplete={next => { if (!next) finishClose(); props.onOpenChangeComplete?.(next); }} open={open} onOpenChange={change} disablePointerDismissal={props.disablePointerDismissal || !dismissible}>{children}</Root></Presentation.Provider>;
}

type ContentProps = Omit<ComponentProps<typeof DialogContent>, "className" | "style" | "render" | "children"> & { className?: string; style?: CSSProperties; render?: ReactElement; children?: ReactNode };
export function DialogDrawerContent(props: ContentProps) {
  return useContext(Presentation) ? <DrawerContent {...props}/> : <DialogContent {...props}/>;
}
export function DialogDrawerTrigger(props: Omit<ComponentProps<typeof DialogTrigger>, "handle">) {
  const Trigger = useContext(Presentation) ? DrawerTrigger : DialogTrigger;
  return <Trigger {...props}/>;
}
export function DialogDrawerClose(props: ComponentProps<typeof DialogClose>) {
  const Close = useContext(Presentation) ? DrawerClose : DialogClose;
  return <Close {...props}/>;
}
// Base UI Drawer Title/Description are the same accessible Dialog implementations.
export { DialogTitle as DialogDrawerTitle, DialogDescription as DialogDrawerDescription, DialogHeader as DialogDrawerHeader };
export function DialogDrawerFooter({className, ...props}: ComponentProps<typeof DialogFooter>) {
  const mobile = useContext(Presentation);
  return <DialogFooter {...props} className={cn(className, mobile && "rounded-b-none")}/>;
}
