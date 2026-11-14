import { CheckIcon } from "@dya/ui/icons"

/** Decorative selected-state mark; the owning primitive exposes checked state. */
export function SelectionMark() {
  return <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary">
    <CheckIcon className="size-3 text-white!" />
  </span>
}
