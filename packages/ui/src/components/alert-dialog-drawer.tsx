"use client";

import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type RefObject, type ReactNode, type ReactElement, type CSSProperties } from "react";
import { AlertDialog, AlertDialogContent, AlertDialogTrigger, AlertDialogCancel, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "./alert-dialog";
import { Drawer, DrawerContent, DrawerTrigger, DrawerClose } from "./drawer";
import { DialogHeader, DialogFooter } from "./dialog";
import { useDialogDrawerPresentation } from "./dialog-drawer";
import { Button } from "./button";
import { cn } from "../lib/utils";

const Confirmation = createContext<{ mobile: boolean; busy: boolean; cancel: RefObject<HTMLButtonElement | null>; trigger: RefObject<HTMLButtonElement | null> } | null>(null);
const Compact = createContext(true);
function useConfirmation() {
  const value = useContext(Confirmation);
  if (!value) throw new Error("AlertDialogDrawer components require AlertDialogDrawer.");
  return value;
}
type Props = Pick<ComponentProps<typeof AlertDialog>, "open" | "defaultOpen" | "onOpenChangeComplete"> & {
  children: ReactNode;
  busy?: boolean;
  onOpenChange?: (open: boolean) => void;
};
/** Explicit confirmation: no outside/swipe dismissal; async actions own completion. */
export function AlertDialogDrawer({ open: controlled, defaultOpen = false, onOpenChange, busy = false, children, ...props }: Props) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlled ?? localOpen;
  const { useDrawer: mobile, finishClose } = useDialogDrawerPresentation(open);
  const cancel = useRef<HTMLButtonElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const restoreTrigger = useRef(false);
  useEffect(() => {
    if (!open && restoreTrigger.current) { trigger.current?.focus(); restoreTrigger.current = false; }
  }, [mobile, open]);
  const change: NonNullable<ComponentProps<typeof Drawer>["onOpenChange"]> = (next, details) => {
    if (!next && (busy || details.reason === "outside-press" || details.reason === "swipe")) { details.cancel(); return; }
    onOpenChange?.(next);
    setLocalOpen(next);
  };
  const complete = (next: boolean) => { if (!next) { restoreTrigger.current = true; finishClose(); } props.onOpenChangeComplete?.(next); };
  return <Confirmation.Provider value={{ mobile, busy, cancel, trigger }}>{mobile
    ? <Drawer {...props} onOpenChangeComplete={complete} open={open} onOpenChange={change} disablePointerDismissal>{children}</Drawer>
    : <AlertDialog {...props} onOpenChangeComplete={complete} open={open} onOpenChange={change}>{children}</AlertDialog>}
  </Confirmation.Provider>;
}
export function AlertDialogDrawerContent({ compact = true, className, ...props }: Omit<ComponentProps<typeof AlertDialogContent>, "initialFocus" | "render" | "style" | "className" | "children"> & { compact?: boolean; render?: ReactElement; style?: CSSProperties; className?: string; children?: ReactNode }) {
  const { mobile, cancel } = useConfirmation();
  const content = { ...props, initialFocus: () => cancel.current, className: cn("gap-0", className) };
  return <Compact.Provider value={compact}>{mobile
    ? <DrawerContent {...content} role="alertdialog" showCloseButton={false} />
    : <AlertDialogContent {...content} />}</Compact.Provider>;
}
export function AlertDialogDrawerTrigger(props: Omit<ComponentProps<typeof AlertDialogTrigger>, "handle">) {
  const { mobile, trigger } = useConfirmation();
  const Trigger = mobile ? DrawerTrigger : AlertDialogTrigger;
  return <Trigger {...props} ref={trigger} />;
}
export function AlertDialogDrawerCancel(props: ComponentProps<typeof Button>) {
  const { mobile, busy, cancel } = useConfirmation();
  const Close = mobile ? DrawerClose : AlertDialogCancel;
  return <Close render={<Button variant="outline" />} {...props} disabled={busy || props.disabled} ref={cancel} data-slot="alert-dialog-cancel" />;
}
/** Does not auto-close: pending operations and failures must remain visible. */
export function AlertDialogDrawerAction(props: ComponentProps<typeof Button>) {
  const { busy } = useConfirmation();
  return <Button {...props} disabled={busy || props.disabled} />;
}
export function AlertDialogDrawerHeader({ className, ...props }: ComponentProps<typeof DialogHeader>) {
  return <DialogHeader {...props} className={cn("pr-3", className)} />;
}
export function AlertDialogDrawerBody({ className, ...props }: ComponentProps<"div">) {
  const compact = useContext(Compact);
  return <div {...props} className={cn("space-y-3", compact ? "pt-3" : "pt-4", className)} />;
}
export function AlertDialogDrawerFooter({ className, ...props }: ComponentProps<typeof DialogFooter>) {
  const compact = useContext(Compact), { mobile } = useConfirmation();
  return <AlertDialogFooter {...props} className={cn(compact && "p-3", mobile && "rounded-b-none", className)} />;
}
export { AlertDialogTitle as AlertDialogDrawerTitle, AlertDialogDescription as AlertDialogDrawerDescription };
