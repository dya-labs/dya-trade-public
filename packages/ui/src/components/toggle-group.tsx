"use client";

import type { ComponentProps } from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "@dya/ui/components/button";
import { cn } from "@dya/ui/lib/utils";

function ToggleGroup({ className, multiple = false, ...props }: Omit<ComponentProps<typeof ToggleGroupPrimitive>, "className"> & { className?: string }) {
  return <ToggleGroupPrimitive data-slot="toggle-group" multiple={multiple} className={cn("flex w-fit items-center gap-1", className)} {...props} />;
}

function ToggleGroupItem({ className, size = "sm", ...props }: Omit<ComponentProps<typeof TogglePrimitive>, "className"> & { className?: string; size?: VariantProps<typeof buttonVariants>["size"] }) {
  return <TogglePrimitive data-slot="toggle-group-item" className={cn(buttonVariants({ variant: "ghost", size }), "text-muted-foreground hover:bg-hover hover:text-foreground dark:hover:bg-hover data-pressed:bg-accent data-pressed:text-accent-foreground data-pressed:hover:bg-[color-mix(in_oklch,var(--accent),var(--foreground)_5%)] dark:data-pressed:hover:bg-[color-mix(in_oklch,var(--accent),var(--foreground)_5%)]", className)} {...props} />;
}

export { ToggleGroup, ToggleGroupItem };
