"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "./dialog";
import { cn } from "../lib/utils";
import type { ComponentProps } from "react";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogCancel = AlertDialogPrimitive.Close;
// Base UI shares Popup, Title, Description and Portal between Dialog and AlertDialog.
export function AlertDialogContent(props: Omit<ComponentProps<typeof DialogContent>, "showCloseButton">) {
  return <DialogContent {...props} showCloseButton={false} />;
}
export function AlertDialogFooter({ className, ...props }: ComponentProps<typeof DialogFooter>) {
  return <DialogFooter {...props} className={cn("grid grid-cols-2 gap-2 border-t-0 bg-transparent px-3 [&>button]:min-w-0 [&>button]:w-full", className)} />;
}
export { DialogHeader as AlertDialogHeader, DialogTitle as AlertDialogTitle, DialogDescription as AlertDialogDescription };
