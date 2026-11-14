"use client";

import { useId } from "react";
import { Radio, RadioGroup, RadioIndicator, type RadioGroupOptions } from "@ui-sdk/react/radio";
import { Badge } from "@dya/ui/components/badge";
import { cn } from "@dya/ui/lib/utils";

export type ExperimentalChoice = { value: string; label: string; description: string; badge?: string; disabled?: boolean };
export type ExperimentalChoiceGroupProps = RadioGroupOptions<string> & { label: string; choices: readonly ExperimentalChoice[]; className?: string };

export function ExperimentalChoiceGroup({ label, choices, className, ...props }: ExperimentalChoiceGroupProps) {
  const id = useId();
  return <RadioGroup {...props} aria-label={label} className={cn("grid gap-2", className)}>
    {choices.map(choice => <label key={choice.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-input bg-card p-4 text-card-foreground transition-colors hover:bg-accent/50 has-[[data-checked]]:border-primary has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-50">
      <Radio value={choice.value} disabled={choice.disabled} aria-labelledby={`${id}-${choice.value}-label`} aria-describedby={`${id}-${choice.value}-description`} className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input text-primary outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-checked:border-primary">
        <RadioIndicator className="size-2 rounded-full bg-current" />
      </Radio>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2"><span id={`${id}-${choice.value}-label`} className="text-sm font-medium">{choice.label}</span>{choice.badge && <Badge variant="secondary">{choice.badge}</Badge>}</span>
        <span id={`${id}-${choice.value}-description`} className="text-sm text-muted-foreground">{choice.description}</span>
      </span>
    </label>)}
  </RadioGroup>;
}
