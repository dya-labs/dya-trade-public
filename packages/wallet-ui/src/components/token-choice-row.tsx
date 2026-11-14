"use client";
import { Button } from '@dya/ui/components/button';
import { Check } from '@dya/ui/icons';
import type { CatalogAsset } from '@dya/wallet-contracts/src/domain/catalog';
import { AssetMark } from './near/asset-mark';

export function TokenChoiceRow({asset,label=asset.symbol,selected,onSelect}:{asset:CatalogAsset;label?:string;selected:boolean;onSelect:()=>void}) {
 return <Button type="button" variant="ghost" aria-label={label} aria-pressed={selected} className="h-auto min-h-12 w-full justify-start rounded-[6px] border-0 px-2 transition-none hover:bg-hover hover:text-foreground focus-visible:bg-hover dark:hover:bg-hover" onClick={onSelect}>
  <AssetMark asset={asset}/><span className="min-w-0 flex-1 text-left">{label}</span>{selected&&<Check className="size-4" aria-hidden="true"/>}
 </Button>;
}
