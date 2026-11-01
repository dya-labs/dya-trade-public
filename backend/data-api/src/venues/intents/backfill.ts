import type { ClickHouse } from "../../clickhouse";
import { log } from "../../log";
import type { IntentDiff } from "./diffs";
import { diffRow, diffsFromLogs } from "./diffs";
import { EXPLORER_PAGE, type ExplorerSwap, type IntentsSources } from "./explorer";
import { intentsSource, loadIntentsState } from "./indexer";

export type BackfillDeps = {
  clickhouse: ClickHouse;
  sources: IntentsSources;
  /** Oldest creation time to reach (exclusive bound of the walk back from the switch minute). */
  target: number;
  invalid?: (detail: string) => void;
};

// 1Click /v0/tokens identifies this as BTC(OMNI), not the separate btc.omft.near bridge.
// Omni deposits settle as nBTC: https://bridge.near.tools/guides/bitcoin.
const EXPLORER_SETTLEMENT_ASSETS: Readonly<Record<string, string>> = {
  "1cs_v1:btc:native:coin": "nep141:nbtc.bridge.near",
};

/** The verifier token an Explorer asset id settles in. */
export const settlementAsset = (asset: string) => EXPLORER_SETTLEMENT_ASSETS[asset] ?? asset;

/**
 * Explorer may also list non-token-diff intents. Recovery instead requires the listed,
 * executed intents to debit the origin and credit the destination for the same account.
 * Net all matching legs so a gas conversion alone cannot stand in for the swap. Unknown
 * Explorer asset aliases deliberately remain gaps until their verifier asset is known.
 */
export function recoveredSwap(swap: Pick<ExplorerSwap, "intentHashes" | "originAsset" | "destinationAsset">, diffs: readonly IntentDiff[]): boolean {
  const origin = settlementAsset(swap.originAsset);
  const destination = settlementAsset(swap.destinationAsset);
  if (!origin || !destination || origin === destination) return false;
  const hashes = new Set(swap.intentHashes);
  const accounts = new Map<string, { origin: bigint; destination: bigint }>();
  for (const diff of diffs) {
    if (!hashes.has(diff.intentHash)) continue;
    let totals = accounts.get(diff.account);
    if (!totals) {
      totals = { origin: 0n, destination: 0n };
      accounts.set(diff.account, totals);
    }
    totals.origin += diff.diff.get(origin) ?? 0n;
    totals.destination += diff.diff.get(destination) ?? 0n;
  }
  return [...accounts.values()].some(total => total.origin < 0n && total.destination > 0n);
}

/**
 * Walks the Explorer's successful 1Click swaps back from the stored position (or the switch
 * minute) to `target`, reading each swap's NEAR transactions from FastNEAR and storing every
 * token_diff of their verifier receipts, exactly as the live indexer would. The position moves
 * only after a whole page is stored, so a restart resumes without loss. Swaps whose parsed
 * diffs do not establish recovery are recorded in `intents_gaps`.
 */
export class IntentsBackfill {
  private stopped = false;

  constructor(private readonly deps: BackfillDeps) {}

  stop(): void { this.stopped = true; }

  async run(): Promise<boolean> {
    const state = await loadIntentsState(this.deps.clickhouse);
    if (state.switchAt === null) return false;
    let position = state.backfill ?? state.switchAt;
    if (position <= this.deps.target) return true;
    log("intents.backfill.start", { from: new Date(position).toISOString(), to: new Date(this.deps.target).toISOString() });
    // The Explorer (one 1,000-row page per 5 s) is the bottleneck, so the next page loads while
    // this one's transactions are read and stored. A page only needs the previous one's oldest time.
    const load = (before: number) => {
      const loading = this.deps.sources.explorer({ before, count: EXPLORER_PAGE, statuses: "SUCCESS", stopped: () => this.stopped });
      loading.catch(() => {}); // awaited below; a page abandoned by stop() must not reject unhandled
      return loading;
    };
    let next = load(position);
    while (!this.stopped && position > this.deps.target) {
      const page = await next;
      if (this.stopped) break;
      // Rows sharing the oldest creation time may continue on the next page; it starts at that time again.
      const oldest = page.length ? Math.min(...page.map(swap => swap.createdAt)) : this.deps.target;
      const following = page.length < EXPLORER_PAGE ? Math.min(oldest, this.deps.target) : Math.min(oldest + 1, position - 1);
      if (following > this.deps.target) next = load(following);
      await this.store(page);
      position = following;
      await this.deps.clickhouse.insert(intentsSource.stateTable, [{ key: "backfill", height: 0, time: String(position) }]);
      log("intents.backfill.page", { swaps: page.length, position: new Date(position).toISOString() });
    }
    if (position <= this.deps.target) log("intents.backfill.done", { position: new Date(position).toISOString() });
    return position <= this.deps.target;
  }

  private async store(page: readonly ExplorerSwap[]): Promise<void> {
    // A swap's token_diff is in its second NEAR transaction (measured: 115 of 115 with one); the
    // first is the deposit. Other transactions are read only when the intents aren't found there.
    const { sources } = this.deps;
    const first = await sources.transactions([...new Set(page.map(swap => swap.nearTxHashes[1] ?? swap.nearTxHashes[0]).filter((hash): hash is string => !!hash))]);
    const diffs = diffsFromLogs([...first.values()].flat(), detail => this.deps.invalid?.(detail));
    const byTransaction = new Map<string, IntentDiff[]>();
    const index = (rows: readonly IntentDiff[]) => {
      for (const diff of rows) {
        const existing = byTransaction.get(diff.txHash);
        if (existing) existing.push(diff);
        else byTransaction.set(diff.txHash, [diff]);
      }
    };
    index(diffs);
    const retry = page.filter(swap => !recoveredSwap(swap, swap.nearTxHashes.flatMap(hash => byTransaction.get(hash) ?? [])));
    const moreLogs = await sources.transactions([...new Set(retry.flatMap(swap => swap.nearTxHashes).filter(hash => !first.has(hash)))]);
    const more = diffsFromLogs([...moreLogs.values()].flat(), detail => this.deps.invalid?.(detail));
    index(more);
    const gaps = page.filter(swap => !recoveredSwap(swap, swap.nearTxHashes.flatMap(hash => byTransaction.get(hash) ?? [])));
    await this.deps.clickhouse.insert(intentsSource.rowsTable, [...diffs, ...more].map(diffRow));
    await this.deps.clickhouse.insert("intents_gaps", gaps.map(swap => ({
      created_at: String(swap.createdAt), deposit_address: swap.depositAddress, intent_hashes: swap.intentHashes,
      origin_asset: swap.originAsset, destination_asset: swap.destinationAsset, reason: swap.nearTxHashes.length ? "intents-not-found" : "no-near-transactions",
    })));
  }
}
