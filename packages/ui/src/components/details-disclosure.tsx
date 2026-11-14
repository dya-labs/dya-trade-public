"use client";

import { useId, type ReactNode } from "react";
import { ChevronDown } from "@dya/ui/icons";
import { Button } from "@dya/ui/components/button";
import { cn } from "@dya/ui/lib/utils";
import { Separator } from "@dya/ui/components/separator";

export function DetailsDisclosure({ label, open, onOpenChange, children, disabled = false, className, "aria-label": ariaLabel }: {
  label: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const id = useId();
  return <div className={cn("flex w-full flex-col gap-4", className)}>
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <Separator />
      <Button variant="ghost" size="sm" disabled={disabled} aria-label={ariaLabel} aria-expanded={open} aria-controls={id} onClick={() => onOpenChange(!open)}>{label}<ChevronDown aria-hidden="true" className={open ? "rotate-180" : undefined} /></Button>
      <Separator />
    </div>
    <div id={id} hidden={!open}>{children}</div>
  </div>;
}
