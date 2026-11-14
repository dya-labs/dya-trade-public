import { cn } from "@dya/ui/lib/utils";

/** Equal-style two-line menu mark; the same strokes rotate into a close mark. */
export function MenuToggleIcon({ open, className }: { open: boolean; className?: string }) {
  return <span aria-hidden="true" className={cn("relative inline-block size-4 shrink-0", className)}>
    {[false, true].map((second) => <span key={String(second)}
      className="absolute left-1/2 top-1/2 h-0.5 w-3.5 rounded-full bg-current transition-transform duration-150 ease-[var(--motion-ease-standard)] motion-reduce:transition-none"
      style={{ transform: `translate(-50%, -50%) ${open ? `rotate(${second ? -45 : 45}deg)` : `translateY(${second ? 3 : -3}px)`}` }}/>) }
  </span>;
}
