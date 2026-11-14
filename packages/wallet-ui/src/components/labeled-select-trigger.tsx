"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@dya/ui/components/button";
import { ChevronDown } from "@dya/ui/icons";

type LabeledSelectTriggerProps = Omit<ComponentProps<typeof Button>, "children" | "value"> & {
  label: string;
  value?: string | null;
  icon?: ReactNode;
  placeholder?: string;
};

export function LabeledSelectTrigger({ label, value, icon, placeholder, className, ...props }: LabeledSelectTriggerProps) {
  return (
    <Button type="button" variant="outline" className={cn("h-16 min-w-0 w-full justify-between", className)} {...props}>
      <span className="flex min-w-0 flex-1 text-left">
        {value != null ? (
          <span className="flex min-w-0 flex-1 items-center gap-3">
            {icon && <span className="flex shrink-0">{icon}</span>}
            <span className="flex min-w-0 flex-1 flex-col items-start">
              <span className="w-full truncate text-xs text-muted-foreground">{label}</span>
              <span className="w-full truncate" title={value}>{value}</span>
            </span>
          </span>
        ) : <span className="truncate text-muted-foreground">{placeholder}</span>}
      </span>
      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
    </Button>
  );
}
