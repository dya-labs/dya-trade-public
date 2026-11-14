import { LoaderCircle } from "@dya/ui/icons";

export function WalletProgress({ title, description }: { title: string; description?: string }) {
  return <div role="status" aria-live="polite" className="mx-auto flex w-full max-w-[328px] flex-col items-center gap-4 text-center">
    <LoaderCircle className="size-12  text-muted-foreground" aria-hidden="true" />
    <p>{title}</p>
    {description && <p className="text-muted-foreground">{description}</p>}
  </div>;
}
