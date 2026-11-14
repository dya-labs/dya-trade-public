import { Check, ChevronDown, AlertCircle } from "../icons";

type ToolProps = { label: string; detail: string; failed: boolean };

export function Tool({ label, detail, failed }: ToolProps) {
  const Icon = failed ? AlertCircle : Check;
  return <details className="group rounded-md border text-xs">
    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-muted-foreground focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
      <span className="ml-auto">{failed ? "Unavailable" : "Checked"}</span>
      <ChevronDown className="size-3.5 group-open:rotate-180" aria-hidden="true" />
    </summary>
    <p className="border-t px-3 py-2 text-muted-foreground">{detail}</p>
  </details>;
}


export function ToolChecks({ checks }: { checks: (ToolProps & { id: number })[] }) {
  if (checks.length === 0) return null;
  if (checks.length === 1) return <Tool {...checks[0]} />;

  return <details className="group/checks rounded-md border text-xs">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 py-2 text-muted-foreground focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
      {checks.length} checks
      <ChevronDown className="size-3.5 group-open/checks:rotate-180" aria-hidden="true" />
    </summary>
    <ol className="space-y-2 border-t px-3 py-2">
      {checks.map(({ id, ...check }) => <li key={id}><Tool {...check} /></li>)}
    </ol>
  </details>;
}
