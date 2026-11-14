"use client";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@dya/ui/components/tooltip";
import { Button } from "@dya/ui/components/button";
import { useCatalogQuery } from "@dya/wallet-ui/hooks/use-wallet-queries";
import { fundingAssets } from "@dya/wallet-contracts/src/domain/funding-balances";
import { D } from "@/lib/near/domain/decimal";
import type { useOrderTicket } from "./use-order-ticket";

export function FundingBalancePrompt({ balances, disabled, onMoveToTrading, fallback = null }: { balances: Pick<NonNullable<ReturnType<typeof useOrderTicket>["balances"]>, "assets"> | null; disabled: boolean; onMoveToTrading: () => void; fallback?: ReactNode }) {
  const catalog = useCatalogQuery();
  if (!balances || !catalog.data || catalog.error) return fallback;
  const assets = catalog.data.assets;
  const fundingIds = new Set(fundingAssets(assets).map(asset => asset.assetId));
  const tradingIds = new Set(assets.filter(asset => asset.blockchain === "near" && !fundingIds.has(asset.assetId)).map(asset => asset.assetId));
  const hasFunding = balances.assets.some(asset => fundingIds.has(asset.assetId) && new D(asset.amount).gt(0));
  const hasTrading = balances.assets.some(asset => tradingIds.has(asset.assetId) && new D(asset.amount).gt(0));
  if (!hasFunding || hasTrading) return fallback;
  return <div className="inline-flex items-center gap-1.5 whitespace-nowrap">{fallback}<span aria-hidden="true">·</span><Tooltip><TooltipTrigger render={<Button variant="link" size="xs" className="h-auto p-0 text-xs leading-4" disabled={disabled} onClick={onMoveToTrading} />}>Move funds</TooltipTrigger><TooltipContent className="max-w-xs">You have funds in Funding. Move them to Trading to place an order.</TooltipContent></Tooltip></div>;
}
