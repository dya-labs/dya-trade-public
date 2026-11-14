"use client";
import { bundledTokenIcon } from "../../lib/bundled-token-icons";
import { NetworkMark } from "./network-mark";
import { useState, type ReactNode } from "react";
import { Coins } from "@dya/ui/icons";
import { useQuery } from "@tanstack/react-query";
import { getTokenIcons } from "../../lib/near/http/catalog-client";
import type { CatalogAsset } from "../../lib/near/domain/catalog";

export function AssetMark({ asset, size = 24, network, networkCount, badge, processing = false }: { asset: CatalogAsset; size?: 24 | 36; network?: string; networkCount?: number; badge?: ReactNode; processing?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const localSrc = bundledTokenIcon(asset.coingeckoIdOverride || (asset.assetId === "nep141:wrap.near" ? "near" : asset.coingeckoId ?? ""));
  const query = useQuery({ queryKey: ["near", "token-icons"], queryFn: ({ signal }) => getTokenIcons(signal), staleTime: 86400000, enabled: !localSrc });
  const src = localSrc ?? query.data?.icons[asset.assetId];
  return <span className="relative flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size }} aria-hidden="true">
    {processing && <span className="pointer-events-none absolute -inset-1 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none" />}
    {!src || failedUrl === src ? <Coins className={size === 36 ? "size-9" : "size-6"} /> : <img src={src} alt="" width={size} height={size} className="size-full rounded-full object-cover" onError={() => setFailedUrl(src)} />}
    {badge ? <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-popover">{badge}</span> : networkCount ? <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border bg-popover text-xs">{networkCount}</span> : network && <span className="absolute -bottom-1 -right-1 rounded-full bg-popover p-0.5"><NetworkMark network={network} size={size === 24 ? 12 : 16} /></span>}
  </span>;
}
