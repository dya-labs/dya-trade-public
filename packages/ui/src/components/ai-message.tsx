"use client";

import { cn } from "../lib/utils";
import type { ComponentProps, HTMLAttributes } from "react";
import { Streamdown } from "streamdown";
import "../styles/typeset.css";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant";
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:border group-[.is-user]:border-foreground/20 group-[.is-user]:bg-foreground/10 group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export function MessageResponse({ className, ...props }: ComponentProps<typeof Streamdown>) {
  return <div className={cn("typeset-chat min-w-0 [&_ul]:list-disc [&_ol]:list-decimal [&_li]:list-item [&_ul,&_ol]:ps-5", className)}><Streamdown {...props} /></div>;
}
