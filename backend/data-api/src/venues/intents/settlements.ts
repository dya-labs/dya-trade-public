import { MINUTE } from "../../candles/kline";
import type { ClickHouse } from "../../clickhouse";
import { log } from "../../log";
import type { IntentDiff } from "./diffs";
import { diffsFromLogs } from "./diffs";
import { recoveredSwap, settlementAsset } from "./backfill";
import { EXPLORER_PAGE, type ExplorerSwap, type IntentsSources } from "./explorer";
import { intentsSource, loadIntentsState } from "./indexer";
import { diffFromRow, DIFF_COLUMNS, type DiffRow } from "./rows";
import type { SettledExchange } from "./trades";
import { settledSwap, transfersFromLogs } from "./transfers";

export const SETTLEMENTS_TABLE = "intents_settlements";

const SETTLEMENT_COLUMNS = `toUnixTimestamp64Milli(block_time) AS time, tx_hash AS tx, origin_asset AS origin, toString(amount_in) AS amountIn,
  destination_asset AS destination, toString(amount_out) AS amountOut, app_fee_bps AS appFeeBps`;
type SettlementRow = { time: number; tx: string; origin: string; amountIn: string; destination: string; amountOut: string; appFeeBps: number };

/** A stored settled swap, as trades derive from it. */
export type StoredSettlement = SettledExchange & { time: number; txHash: string };

const fromRow = (row: SettlementRow): StoredSettlement => ({
  time: Number(row.time), txHash: row.tx, originAsset: row.origin, amountIn: BigInt(row.amountIn),
  destinationAsset: row.destination, amountOut: BigInt(row.amountOut), appFeeBps: Number(row.appFeeBps),
});

const list = (values: Iterable<string>) => `[${[...values].map(id => `'${id.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`).join(",")}]`;

/** Stored settled swaps paid out in [from, to), of any asset (or only those touching `assetIds`), oldest first. */
export async function storedSettlements(clickhouse: ClickHouse, from: number, to: number, assetIds?: readonly string[]): Promise<StoredSettlement[]> {
  const rows = await clickhouse.query<SettlementRow>(
    `SELECT ${SETTLEMENT_COLUMNS} FROM ${SETTLEMENTS_TABLE} FINAL
     WHERE block_time >= fromUnixTimestamp64Milli({from:Int64}, 'UTC') AND block_time < fromUnixTimestamp64Milli({to:Int64}, 'UTC')
       ${assetIds ? "AND (has({ids:Array(String)}, origin_asset) OR has({ids:Array(String)}, destination_asset))" : ""}
     ORDER BY block_time, deposit_address`,
    { from, to, ...(assetIds ? { ids: list(assetIds) } : {}) });
  return rows.map(fromRow);
}

/** The newest `limit` stored settled swaps touching `assetIds` since `from`, newest first. */
export async function recentSettlements(clickhouse: ClickHouse, assetIds: readonly string[], from: number, limit: number): Promise<StoredSettlement[]> {
  const rows = await clickhouse.query<SettlementRow>(
    `SELECT ${SETTLEMENT_COLUMNS} FROM ${SETTLEMENTS_TABLE} FINAL
     WHERE block_time >= fromUnixTimestamp64Milli({from:Int64}, 'UTC') AND (has({ids:Array(String)}, origin_asset) OR has({ids:Array(String)}, destination_asset))
     ORDER BY block_time DESC LIMIT {limit:UInt32}`,
    { from, ids: list(assetIds), limit });
  return rows.map(fromRow);
}

// The Explorer lists a swap once 1Click sees its deposit, under its quote's creation time. Of
// 17,898 settled swaps over two days, 0.9% paid out over an hour after creation, 6 over three
// hours and 2 over six (at most 22.5 h). Each poll re-reads swaps created this far back.
const SWEEP_MS = 3 * 60 * MINUTE;
// Live payouts were stored a median 86 s after their block, at most 139 s (41 swaps polled every
// 30 s); one transaction of 298 was listed 232 s after its block. The watermark trails
// polls by this; a payout listed later (or a swap listed beyond the sweep) is stored late (logged)
// and reaches candles with the next repair over its hour. The Intents venue allows the resulting sync lag.
const LISTING_LAG_MS = 5 * MINUTE;
const POLL_MS = 30_000;
// An Explorer swap executes up to 30 minutes after its creation; its stored intents are looked up this far.
const EXECUTION_MS = 2 * 60 * MINUTE;
/** Explorer statuses of a swap whose deposit 1Click has seen and that has not finished. */
const IN_FLIGHT = new Set(["PROCESSING", "KNOWN_DEPOSIT_TX"]);
const FAILED = new Set(["REFUNDED", "FAILED"]);

const swapKey = (swap: Pick<ExplorerSwap, "deposit" | "createdAt">) => `${swap.deposit}\n${swap.createdAt}`;
const sameSettlement = (a: StoredSettlement, b: StoredSettlement) => a.time === b.time && a.amountIn === b.amountIn && a.amountOut === b.amountOut;

export type SettlementsDeps = {
  clickhouse: ClickHouse;
  sources: IntentsSources;
  /** Oldest creation time the history walk reaches (the switch minute less the execution margin). */
  target: number;
  invalid?: (detail: string) => void;
  /** Newly settled swaps, once each, for live trades. */
  stored?: (settlements: StoredSettlement[]) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Stores the 1Click swaps settled by transfers (`settledSwap`), from the Explorer's swaps and
 * their NEAR transactions (FastNEAR). Swaps whose listed intents executed as token_diff are left
 * to the token_diff indexer. Live: every poll lists the swaps created within the sweep, reads the
 * transactions of each successful swap once and of each in-flight swap whenever its transaction
 * list grows, and stores a swap as soon as its payout is on chain (again when it succeeds). Every
 * payout before the poll less the listing lag is then
 * stored: the `settlements` watermark. History walks successful swaps back from where live
 * listing started to `target`.
 */
export class IntentsSettlements {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private stopped = false;
  /** In-flight swaps by key: creation time, the transactions last read, and the settlement stored from them. */
  private readonly pending = new Map<string, { created: number; read: string; settled?: StoredSettlement }>();
  /** Finished swaps already handled, by key: their creation time (pruned past the sweep). */
  private readonly done = new Map<string, number>();
  private watermark: number | null = null;
  private polled = false;

  constructor(private readonly deps: SettlementsDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? Bun.sleep;
  }

  stop(): void { this.stopped = true; }

  async run(): Promise<void> {
    const state = await loadIntentsState(this.deps.clickhouse);
    this.watermark = state.settlements;
    let history = state.settlementsHistory;
    if (this.watermark === null || history === null) {
      // First start: live listing covers swaps created from here on; history those before.
      const start = this.now() - SWEEP_MS;
      this.watermark ??= start;
      history ??= start;
      await this.deps.clickhouse.insert(intentsSource.stateTable, [
        { key: "settlements", height: 0, time: String(this.watermark) }, { key: "settlements_history", height: 0, time: String(history) }]);
    }
    // A swap listed late carries an older creation time, as within any poll's sweep.
    await Promise.all([this.live(this.watermark - SWEEP_MS), this.history(history)]);
  }

  /** Polls until stopped, first listing back to `start`. */
  private async live(start: number): Promise<void> {
    let floor = start;
    while (!this.stopped) {
      const started = this.now();
      try {
        await this.poll(floor);
        floor = started - SWEEP_MS;
      } catch (error) {
        log("intents.settlements.poll.failed", { error: String(error) }, "error");
      }
      const wait = started + POLL_MS - this.now();
      if (wait > 0 && !this.stopped) await this.sleep(wait);
    }
  }

  /** Lists swaps created since `floor`, stores new settlements, moves the watermark. */
  async poll(floor: number): Promise<void> {
    const listedAt = this.now();
    const listed = new Map<string, ExplorerSwap>();
    let before: number | undefined;
    while (!this.stopped) {
      const page = await this.deps.sources.explorer({ before, count: EXPLORER_PAGE, urgent: true, stopped: () => this.stopped });
      for (const swap of page) if (swap.createdAt >= floor) listed.set(swapKey(swap), swap);
      const oldest = Math.min(...page.map(swap => swap.createdAt));
      if (page.length < EXPLORER_PAGE || oldest < floor) break;
      // Rows sharing the oldest creation time may continue on the next page.
      if (before !== undefined && oldest + 1 >= before) throw new Error("Explorer page did not advance");
      before = oldest + 1;
    }
    if (this.stopped) return;
    const reads: ExplorerSwap[] = [];
    for (const [key, swap] of listed) {
      if (this.done.has(key)) continue;
      if (FAILED.has(swap.status)) { this.done.set(key, swap.createdAt); this.pending.delete(key); }
      else if (swap.status === "SUCCESS" || (IN_FLIGHT.has(swap.status) && this.pending.get(key)?.read !== swap.nearTxHashes.join(","))) reads.push(swap);
    }
    const settled = await this.settle(reads);
    const fresh: StoredSettlement[] = [];
    let revised = 0;
    for (const swap of reads) {
      const key = swapKey(swap), before = this.pending.get(key)?.settled, after = settled.get(key);
      if (after && !before) fresh.push(after);
      if (after && before && !sameSettlement(after, before)) revised++;
      if (swap.status === "SUCCESS") { this.done.set(key, swap.createdAt); this.pending.delete(key); }
      else this.pending.set(key, { created: swap.createdAt, read: swap.nearTxHashes.join(","), settled: after ?? before });
    }
    // Corrected candles carry a revised settlement; its live trade stays as first published.
    if (revised) log("intents.settlements.revised", { swaps: revised });
    // Payouts listed after the watermark passed them (the first poll re-reads what was stored before a restart).
    const late = this.polled ? fresh.filter(entry => entry.time < (this.watermark ?? -Infinity)) : [];
    if (late.length) log("intents.settlements.late", { swaps: late.length, oldest: new Date(Math.min(...late.map(entry => entry.time))).toISOString() }, "warn");
    this.polled = true;
    if (fresh.length) this.deps.stored?.(fresh);
    // Later polls list from later floors, so swaps created before this one are never listed again.
    for (const [key, entry] of this.pending) if (entry.created < floor) this.pending.delete(key);
    for (const [key, created] of this.done) if (created < floor) this.done.delete(key);
    const watermark = listedAt - LISTING_LAG_MS;
    if (this.watermark === null || watermark > this.watermark) {
      this.watermark = watermark;
      await this.deps.clickhouse.insert(intentsSource.stateTable, [{ key: "settlements", height: 0, time: String(watermark) }]);
    }
  }

  private async history(start: number): Promise<void> {
    let position = start;
    if (position <= this.deps.target) return;
    log("intents.settlements.history.start", { from: new Date(position).toISOString(), to: new Date(this.deps.target).toISOString() });
    while (!this.stopped && position > this.deps.target) {
      const page = await this.deps.sources.explorer({ before: position, count: EXPLORER_PAGE, statuses: "SUCCESS", stopped: () => this.stopped });
      if (this.stopped) break;
      const oldest = page.length ? Math.min(...page.map(swap => swap.createdAt)) : this.deps.target;
      const following = page.length < EXPLORER_PAGE ? Math.min(oldest, this.deps.target) : Math.min(oldest + 1, position - 1);
      const settled = await this.settle(page);
      position = following;
      await this.deps.clickhouse.insert(intentsSource.stateTable, [{ key: "settlements_history", height: 0, time: String(position) }]);
      log("intents.settlements.history.page", { swaps: page.length, settled: settled.size, position: new Date(position).toISOString() });
    }
    if (position <= this.deps.target) log("intents.settlements.history.done", { position: new Date(position).toISOString() });
  }

  /**
   * Stores the swaps among `swaps` (successful or in flight) whose payout is on chain; returns
   * them by key. Successful swaps that settle neither way are counted by reason.
   */
  async settle(swaps: readonly ExplorerSwap[]): Promise<Map<string, StoredSettlement>> {
    const settled = new Map<string, StoredSettlement>();
    // Confidential swaps and same-asset moves are no public trade; empty swaps have nothing to read.
    const candidates = swaps.filter(swap => {
      const origin = settlementAsset(swap.originAsset), destination = settlementAsset(swap.destinationAsset);
      return swap.nearTxHashes.length > 0 && origin !== destination && !origin.startsWith("1cs_v1:") && !destination.startsWith("1cs_v1:");
    });
    if (!candidates.length) return settled;
    // Swaps whose intents the token_diff indexer already stored need no transactions.
    const created = candidates.map(swap => swap.createdAt);
    const stored = await this.storedDiffs(candidates.flatMap(swap => swap.intentHashes), Math.min(...created), Math.max(...created) + EXECUTION_MS);
    const open = candidates.filter(swap => !recoveredSwap(swap, swap.intentHashes.flatMap(hash => stored.get(hash) ?? [])));
    const logs = await this.deps.sources.transactions([...new Set(open.flatMap(swap => swap.nearTxHashes))]);
    const invalid = (detail: string) => this.deps.invalid?.(detail);
    const rows: Record<string, unknown>[] = [];
    const reasons: Record<string, number> = {};
    for (const swap of open) {
      const swapLogs = swap.nearTxHashes.flatMap(hash => logs.get(hash) ?? []);
      if (recoveredSwap(swap, diffsFromLogs(swapLogs, invalid))) continue;
      const appFeeBps = swap.appFeeBps;
      const result = appFeeBps === null ? { reason: "invalid-app-fee" } as const : settledSwap(swap, transfersFromLogs(swapLogs, invalid));
      if (!("swap" in result)) {
        if (swap.status === "SUCCESS") reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
        continue;
      }
      if (appFeeBps === null) continue;
      const found = result.swap;
      rows.push({
        created_at: String(swap.createdAt), deposit_address: swap.deposit, block_time: String(found.time), block_height: found.height,
        tx_hash: found.txHash, account_id: found.account, settler_id: found.settler,
        origin_asset: found.originAsset, amount_in: String(found.amountIn), destination_asset: found.destinationAsset, amount_out: String(found.amountOut),
        app_fee_bps: appFeeBps, referral: swap.referral,
      });
      settled.set(swapKey(swap), { time: found.time, txHash: found.txHash, originAsset: found.originAsset, amountIn: found.amountIn, destinationAsset: found.destinationAsset, amountOut: found.amountOut, appFeeBps });
    }
    await this.deps.clickhouse.insert(SETTLEMENTS_TABLE, rows);
    if (Object.keys(reasons).length) log("intents.settlements.unsettled", { swaps: candidates.length, settled: rows.length, ...reasons });
    return settled;
  }

  /** Stored token_diff intents with these hashes, executed in [from, to). */
  private async storedDiffs(hashes: readonly string[], from: number, to: number): Promise<Map<string, IntentDiff[]>> {
    const rows: DiffRow[] = [];
    const unique = [...new Set(hashes)];
    // Bound each HTTP field well below ClickHouse's 128 KiB default.
    for (let offset = 0; offset < unique.length; offset += 100) {
      rows.push(...await this.deps.clickhouse.query<DiffRow>(
        `SELECT ${DIFF_COLUMNS} FROM intents_diffs FINAL
         WHERE block_time >= fromUnixTimestamp64Milli({from:Int64}, 'UTC') AND block_time < fromUnixTimestamp64Milli({to:Int64}, 'UTC') AND intent_hash IN {hashes:Array(String)}`,
        { from, to, hashes: list(unique.slice(offset, offset + 100)) }));
    }
    return Map.groupBy(rows.map(diffFromRow), diff => diff.intentHash);
  }
}
