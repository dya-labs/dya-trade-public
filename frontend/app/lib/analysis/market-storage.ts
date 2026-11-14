import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";

// Keep existing NEAR settings/history; every other asset gets its own namespace.
export function analysisStorage(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, assetId: string) {
  const key = (name: string) => assetId === DEFAULT_PAIR.base.assetId ? name : `${name}:${encodeURIComponent(assetId)}`;
  return {
    getItem: (name: string) => storage.getItem(key(name)),
    setItem: (name: string, value: string) => storage.setItem(key(name), value),
    removeItem: (name: string) => storage.removeItem(key(name)),
  };
}
