import { nextTokenRecord } from "../../../../../packages/catalog/src";
import { tokenIdentity, tokenApproved, tokenAllowed, tradingPairAllowed, type TokenCapability } from "../../../../../packages/wallet-contracts/src/domain/token-registry";
import type { CatalogAsset, SelectedPair } from "../../../../../packages/wallet-contracts/src/domain/catalog";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import type { SnapshotReader, State, StateStore } from "../repositories/store";

export async function discoverTokens(store: StateStore, assets: CatalogAsset[], now = Date.now()) {
  await discover(store, assets, now);
}
/**
 * Discovers `assets`, then runs `check` on state that includes them: on the discovery read's own
 * snapshot when nothing changed (the usual case), otherwise on a read after the discovery write.
 */
export async function discoverTokensThen<T>(store: StateStore, assets: CatalogAsset[], check: (s: State) => T, now = Date.now(), first: SnapshotReader = store): Promise<T> {
  const checked = await discover(store, assets, now, check, first);
  return checked ? checked.value : store.read(check);
}
/** `first` answers the discovery read: a snapshot the request holds will do, since the caller decides on fresh state again before it stores anything. */
async function discover<T>(store: StateStore, assets: CatalogAsset[], now: number, check?: (s: State) => T, first: SnapshotReader = store) {
  if (new Set(assets.map(a => a.assetId)).size !== assets.length) throw new AppError(ErrorCode.OneClickTokenDiscoveryUnavailable);
  const identities = assets.map(tokenIdentity);
  const { changes, checked } = await first.read(s => {
    const changes = identities.filter(identity => nextTokenRecord(s.tokens && Object.hasOwn(s.tokens, identity.assetId) ? s.tokens[identity.assetId] : undefined, identity, now));
    return { changes, checked: !changes.length && check ? { value: check(s) } : undefined };
  });
  if (!changes.length) return checked;
  await store.transaction(s => {
    s.tokens ??= {};
    for (const observed of changes) {
      const old = Object.hasOwn(s.tokens, observed.assetId) ? s.tokens[observed.assetId] : undefined;
      const next = nextTokenRecord(old, observed, now);
      if (next) Object.defineProperty(s.tokens, next.id, { value: next, configurable: true, writable: true, enumerable: true });
    }
  });
  return undefined;
}
export function requireToken(s: State, asset: CatalogAsset, capability: TokenCapability) {
  if (!tokenAllowed(asset, s.tokens?.[asset.assetId], capability)) throw new AppError(ErrorCode.TokenOperationUnavailable);
}
export function requireApprovedPair(s: State, pair: SelectedPair | undefined) {
  if (!pair || !tokenApproved(pair.base, s.tokens?.[pair.base.assetId]) || !tokenApproved(pair.quote, s.tokens?.[pair.quote.assetId])) throw new AppError(ErrorCode.TokenOperationUnavailable);
}
export function requireTradingPair(s: State, pair: SelectedPair | undefined) {
  if (!pair || !tradingPairAllowed(pair, s.tokens)) throw new AppError(ErrorCode.TokenOperationUnavailable);
}
