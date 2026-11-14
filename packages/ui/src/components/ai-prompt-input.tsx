"use client";

import type { ComponentProps } from "react";
import { ArrowUp, LoaderCircle } from "../icons";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "./input-group";

export function PromptInput({ children, ...props }: ComponentProps<"form">) {
  return <form {...props}><InputGroup>{children}</InputGroup></form>;
}

export function PromptInputTextarea({ onKeyDown, ...props }: ComponentProps<typeof InputGroupTextarea>) {
  return <InputGroupTextarea {...props} onKeyDown={event => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }} />;
}

export function PromptInputSubmit({ waiting, disabled }: { waiting: boolean; disabled: boolean }) {
  return <InputGroupAddon align="inline-end" className="self-end has-[>button]:pr-3">
    <InputGroupButton type="submit" size="icon-sm" variant="default" disabled={disabled} aria-label="Send">
      {waiting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
    </InputGroupButton>
  </InputGroupAddon>;
}
