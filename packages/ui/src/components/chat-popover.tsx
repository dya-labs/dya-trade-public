"use client";

import type { ReactNode } from "react";
import { Popover, PopoverClose, PopoverContent, PopoverTitle, PopoverTrigger } from "@ui-sdk/react/popover";
import { MessageSquare, X } from "../icons";
import { Button } from "./button";

export function ChatPopover({ title, children }: { title: string; children: ReactNode }) {
  return <Popover>
    <PopoverTrigger render={<Button variant="ghost" className="h-14 w-full gap-1.5 rounded-none text-xs sm:h-7 sm:w-auto sm:rounded-md" />}>
      <MessageSquare aria-hidden="true" />{title}
    </PopoverTrigger>
    <PopoverContent side="top" align="end" sideOffset={8}
      className="z-50 flex h-[min(30rem,65dvh)] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <PopoverTitle className="text-sm font-medium">{title}</PopoverTitle>
        <PopoverClose render={<Button variant="ghost" size="icon-sm" aria-label="Close chat" />}><X /></PopoverClose>
      </div>
      {children}
    </PopoverContent>
  </Popover>;
}
