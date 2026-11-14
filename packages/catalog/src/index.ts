import type { CatalogAsset } from "../../wallet-contracts/src/domain/catalog";
import { tokenIdentity, sameTokenIdentity, type TokenRecord } from "../../wallet-contracts/src/domain/token-registry";
import type { Network } from "../../wallet-contracts/src/domain/networks";
export type { CatalogAsset, TokenRecord, Network };

/**
 * How long a token's observed identity stands once it has changed. Readers keep the provider's
 * list for minutes, so right after a change some still hold the previous one; without this they
 * and the readers holding the new list would rewrite the token in turns.
 * A reader whose list differs meanwhile is refused the token, as for any identity it did not review.
 */
export const TOKEN_IDENTITY_SETTLE_MS = 30 * 60_000;
/** Shared discovery rules; no wallet, auth or persistence dependencies. */
export function nextTokenRecord(old: TokenRecord | undefined, asset: CatalogAsset, now: number): TokenRecord | undefined {
  const observed = tokenIdentity(asset);
  if (old && (sameTokenIdentity(old.observed, observed) || (old.observedAt !== undefined && now - old.observedAt < TOKEN_IDENTITY_SETTLE_MS))) return undefined;
  return old ? { ...old, observed, observedAt: now, status: "pending", trading: false, deposits: false, withdrawals: false, updatedAt: now, revision: old.revision + 1 }
    : { id: observed.assetId, identity: observed, observed, name: observed.symbol, iconUrl: "", status: "pending", trading: false, deposits: false, withdrawals: false, discoveredAt: now, updatedAt: now, revision: 0 };
}
export function pendingNetwork(id: string, now: number): Network {
  return { id, name: id, iconUrl: "", explorerUrl: "", evmChainId: null, addressKind: "provider", status: "pending", deposits: false, withdrawals: false, discoveredAt: now, updatedAt: now, revision: 0 };
}
