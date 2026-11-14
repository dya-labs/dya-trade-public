import type { ReactNode } from "react";
import { BrandLogo } from "@dya/ui/components/brand-logo";
import { Card, CardContent, CardHeader, CardTitle } from "@dya/ui/components/card";

import artwork from "../brand/graphics/auth-entry.webp?url";

type AuthBrandCardProps = {
  brandName: string;
  title: ReactNode;
  description?: ReactNode;
  homeHref?: string;
};

/** Shared desktop artwork for Terminal and ID entry pages. */
export function AuthBrandCard({ brandName, title, description, homeHref }: AuthBrandCardProps) {
  const identity = <BrandLogo size={16} name={brandName} />;
  return <Card className="fixed left-4 top-4 hidden h-[calc(100dvh-2rem)] w-[45vw] overflow-hidden bg-black py-8 lg:flex xl:py-10">
    <div className="pointer-events-none absolute inset-0" aria-hidden="true"><img src={artwork} alt="" className="h-full w-full object-cover" /></div>
    <CardHeader className="relative px-8 xl:px-10">
      {homeHref ? <a href={homeHref} aria-label={`${brandName} home`} className="flex w-fit rounded-sm focus-visible:outline-2 focus-visible:outline-ring">{identity}</a> : identity}
    </CardHeader>
    <CardContent className="relative flex flex-1 flex-col justify-end gap-3 px-8 xl:px-10">
      <CardTitle className="max-w-[12ch] text-4xl font-medium leading-[1.15] tracking-tight xl:text-5xl">{title}</CardTitle>
      {description && <p className="text-muted-foreground">{description}</p>}
    </CardContent>
  </Card>;
}
