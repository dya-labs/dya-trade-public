"use client";
import { useEffect, useRef, type ComponentProps } from "react";
import { SuccessMark } from "@dya/ui/components/success-mark";
import { LoaderCircle } from "@dya/ui/icons";
import { cn } from "@dya/ui/lib/utils";

type StepperProps = ComponentProps<"ol"> & {
  steps: readonly string[];
  /** One-based index of the current step. */
  current: number;
  complete?: boolean;
  /** Shows work in progress on the current step until it advances or completes. */
  loading?: boolean;
};

/** Read-only progress indicator; surrounding controls own navigation. */
export function Stepper({ steps, current, complete = false, loading = false, className, "aria-label": label = "Progress", ...props }: StepperProps) {
  const previousLoadingStep = useRef<number | null>(null);
  const loadingStep = loading && !complete ? current : null;
  const finishingStep = previousLoadingStep.current;
  useEffect(() => { previousLoadingStep.current = loadingStep; }, [loadingStep]);
  return <ol {...props} aria-label={label} className={cn("grid auto-cols-fr grid-flow-col", className)}>
    {steps.map((label, index) => {
      const step = index + 1;
      const done = step < current || complete;
      const pending = loading && !complete && step === current;
      return <li key={label} aria-busy={pending || undefined} aria-current={!complete && step === current ? "step" : undefined} className="relative flex flex-col items-center gap-2 text-center">
        {index < steps.length - 1 && <span aria-hidden="true" className="absolute left-[calc(50%+0.75rem)] top-3 h-px w-[calc(100%-1.5rem)] bg-border"><span className="absolute inset-0 origin-left bg-success transition-transform duration-200 ease-out motion-reduce:transition-none" style={{ transform: done ? "scaleX(1)" : "scaleX(0)" }} /></span>}
        <span className={`relative z-10 flex size-6 items-center justify-center rounded-full border text-sm transition-colors duration-150 ease-out motion-reduce:transition-none ${done ? "border-success bg-success text-foreground" : pending ? "border-primary bg-primary text-foreground" : step === current ? "border-primary bg-background text-primary" : "border-border bg-transparent text-muted-foreground"}`}>
          <span className={cn("absolute flex size-4 items-center justify-center transition-opacity duration-100 ease-out motion-reduce:transition-none", pending ? "opacity-100" : "opacity-0")} aria-hidden="true">
            <LoaderCircle className={cn("size-4 [&_circle]:[stroke-width:2.5]", !pending && "dya-spinner-paused")} />
          </span>
          <SuccessMark complete={done} delay={finishingStep === step ? 100 : 0} />
          <span className="sr-only">{done ? "Completed" : pending ? "In progress" : step === current ? "Current step" : "Upcoming step"}</span>
        </span>
        <span className="text-xs text-foreground">{label}</span>
      </li>;
    })}
  </ol>;
}
