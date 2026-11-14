"use client";

import { ChevronRight } from "@dya/ui/icons";
import { type ComponentProps, type ReactNode } from "react";
import { Card, CardContent } from "@dya/ui/components/card";
import { cn } from "@dya/ui/lib/utils";

export function WalletSection({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("space-y-3", className)} {...props} />;
}

export function WalletSectionHeader({ children, href }: { children: string; href?: string }) {
  return <h2>{href ? <a href={href} className="inline-flex items-center gap-1" aria-label={`View all ${children.toLowerCase()}`}>{children}<ChevronRight className="size-4" aria-hidden="true" /></a> : children}</h2>;
}

/** Owns the shared card surface and list separator styling; headings remain outside it. */
export function WalletSectionContent({ children, unboxed = false }: { children: ReactNode; unboxed?: boolean }) {
  return unboxed ? <>{children}</> : <Card size="sm" className="overflow-hidden py-0"><CardContent className="space-y-4 px-0 [&_[data-slot=table-row]]:border-foreground/10 [&>.divide-y>*]:border-foreground/10 [&>p]:p-3 [&>[data-slot=alert]]:mx-3 [&>button]:ml-3">{children}</CardContent></Card>;
}

/** Empty sections have one dashed outline and inherit their parent's surface. */
export function WalletSectionEmpty({ children, className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex min-h-24 items-center justify-center rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground", className)} {...props}>{children}</div>;
}
