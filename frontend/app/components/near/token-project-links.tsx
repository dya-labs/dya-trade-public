import { useQuery } from "@tanstack/react-query";
import { XIcon } from "@dya/ui/components/social-icons";
import { Globe } from "@dya/ui/icons";
import { Button } from "@dya/ui/components/button";
import { getTokenLinks } from "@/lib/near/http/catalog-client";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import type { CatalogAsset } from "@/lib/near/domain/catalog";

export function TokenProjectLinks({ asset }: { asset: CatalogAsset }) {
  const query = useQuery({ queryKey: ["near", "token-links"], queryFn: ({ signal }) => getTokenLinks(signal), staleTime: 300_000, refetchInterval: 300_000, retry: false });
  const links = query.data?.assets[asset.assetId];
  const symbol = displaySymbol(asset);
  if (!links?.website && !links?.x) return null;
  return <div className="min-w-0"><span className="block text-[11px] uppercase tracking-wider text-muted-foreground">Links</span><div className="flex h-6 items-center gap-0.5">
    {links.website && <Button variant="ghost" size="icon-xs" aria-label={`${symbol} website`} title={`${symbol} website`} render={<a href={links.website} target="_blank" rel="noopener noreferrer" />}><Globe /></Button>}
    {links.x && <Button variant="ghost" size="icon-xs" aria-label={`${symbol} on X`} title={`${symbol} on X`} render={<a href={links.x} target="_blank" rel="noopener noreferrer" />}><XIcon /></Button>}
  </div></div>;
}
