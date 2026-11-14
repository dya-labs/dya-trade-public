"use client";
import { Network } from "@dya/ui/icons";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNetworkIcons } from "../../lib/near/http/catalog-client";

export function NetworkMark({ network, size = 24 }: { network: string; size?: 12 | 16 | 24 | 32 | 36 }) {
  const [failed, setFailed] = useState<string>();
  const query = useQuery({ queryKey: ["near", "network-icons", 2], queryFn: ({ signal }) => getNetworkIcons(signal), staleTime: 86400000 });
  const src = query.data?.icons[network];
  return <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-full" style={{ width: size, height: size }} aria-hidden="true">
    {src && failed !== src ? <img src={src} alt="" width={size} height={size} className="size-full object-contain" onError={() => setFailed(src)} /> : <Network className={size === 36 ? "size-9" : size === 32 ? "size-8" : size === 24 ? "size-6" : size === 12 ? "size-3" : "size-4"} />}
  </span>;
}
