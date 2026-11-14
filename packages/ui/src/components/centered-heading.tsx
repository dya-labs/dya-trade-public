import type { ReactNode } from "react";

export function CenteredHeading({ icon, title, description, as: Heading = "h2" }: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  as?: "h1" | "h2" | "h3";
}) {
  return <div className="flex min-w-0 flex-col items-center gap-4 py-2 text-center">
    {icon}
    <div className="min-w-0 space-y-2">
      <Heading className="break-words text-xl font-medium">{title}</Heading>
      {description != null && <div className="text-sm text-muted-foreground">{description}</div>}
    </div>
  </div>;
}
