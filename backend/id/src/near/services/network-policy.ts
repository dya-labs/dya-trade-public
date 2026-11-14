import { pendingNetwork } from "../../../../../packages/catalog/src";
import { networkAllowed } from "../../../../../packages/wallet-contracts/src/domain/networks";
import type { CatalogAsset } from "../../../../../packages/wallet-contracts/src/domain/catalog";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import type { State, StateStore } from "../repositories/store";

export async function discoverNetworks(store: StateStore, assets: CatalogAsset[], now = Date.now()) {
  const ids = [...new Set(assets.map(a => a.blockchain))];
  const missing = await store.read(s => ids.filter(id => !s.networks || !Object.hasOwn(s.networks, id)));
  if (!missing.length) return;
  await store.transaction(s => {
    s.networks ??= {};
    for (const id of missing) if (!Object.hasOwn(s.networks, id))
      Object.defineProperty(s.networks, id, { configurable: true, enumerable: true, writable: true, value: pendingNetwork(id, now) });
  });
}
export function requireNetwork(s: State, id: string, direction: "deposits" | "withdrawals") {
  if (!networkAllowed(s.networks?.[id], direction)) throw new AppError(ErrorCode.NetworkTransferUnavailable);
  return s.networks![id];
}
