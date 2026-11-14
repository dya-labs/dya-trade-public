"use client";
import { useCatalogQuery } from "./use-wallet-queries";
export function useNetworkName() {
  const catalog = useCatalogQuery();
  return (chain: string) => catalog.data?.networks?.find(n => n.id === chain)?.name ?? chain;
}
