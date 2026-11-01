import type { ClickHouse } from "../clickhouse";
import { klineRow, MINUTE, RESOLUTION_MS, type Resolution } from "../candles/kline";
import { MAX_SYNC_LAG_MS } from "../live/protocol";
import type { Venue, VenueRest } from "../venues/types";

export type SyncState = { firstOpenTime: number | null; syncedTo: number };
/** `pending`: the pass ended before this symbol caught up (a backfill continues next pass). */
export type SyncResult = { symbol: string; rows: number; syncedTo: number; pending?: boolean; error?: string };

/** sync_state dataset per stored resolution; 1m lives in klines_1m, coarser tiers in klines_native. */
export const DATASETS: Record<Resolution, string> = { "1m": "klines_1m", "1h": "klines_1h", "1d": "klines_1d" };
// Persist only minutes closed at least this long ago, so the venue has finalized them.
const SETTLE_MS = 10_000;
// ClickHouse prefers few large inserts; backfill pages are buffered up to this many rows.
const FLUSH_ROWS = 100_000;

const ceil = (time: number, step: number) => Math.ceil(time / step) * step;

/** Buffered rows and the checkpoints they justify, for one syncAll run. */
class Batch {
  minutes: object[] = [];
  native: object[] = [];
  states = new Map<string, { symbol: string; dataset: string; state: SyncState }>();
  caughtUp: { symbol: string; at: number }[] = [];
  private flushing = Promise.resolve();

  constructor(private readonly clickhouse: ClickHouse, private readonly venue: string, private readonly now: () => number) {}

  get size(): number { return this.minutes.length + this.native.length; }

  /**
   * Serialized: rows first, then checkpoints, then caught-up marks. After a failed insert the
   * chain stays rejected, so no later checkpoint or mark can skip over rows that were never stored.
   */
  flush(): Promise<void> {
    const { minutes, native, states, caughtUp } = this;
    this.minutes = [];
    this.native = [];
    this.states = new Map();
    this.caughtUp = [];
    const updatedAt = String(this.now());
    this.flushing = this.flushing.then(async () => {
      await this.clickhouse.insert("klines_1m", minutes);
      await this.clickhouse.insert("klines_native", native);
      await this.clickhouse.insert("sync_state", [...states.values()].map(({ symbol, dataset, state }) => ({
        venue: this.venue, symbol, dataset,
        first_open_time: state.firstOpenTime === null ? null : String(state.firstOpenTime),
        synced_to: String(state.syncedTo), updated_at: updatedAt,
      })));
      await this.clickhouse.insert("market_caught_up", caughtUp.map(({ symbol, at }) => ({ venue: this.venue, symbol, caught_up_at: String(at) })));
    });
    return this.flushing;
  }
}

/**
 * REST is the only writer of stored candles. 1m pages forward from its checkpoint (or from the
 * venue's earliest minute) and advances the checkpoint only after the rows are stored, so a
 * crash replays at most one buffer and never skips minutes. The same routine performs the
 * initial backfill, catch-up after downtime, and steady-state sync.
 *
 * Venues with short 1m retention also store native 1h candles up to the first stored 1m hour,
 * and native 1d candles up to the first stored day of the finer tiers; each tier is synced once.
 * Callers must not run syncAll concurrently with itself.
 */
export class KlineSync {
  private readonly now: () => number;

  constructor(private readonly deps: { clickhouse: ClickHouse; rest: VenueRest; venue: Pick<Venue, "id" | "history" | "maxSyncLagMs">; concurrency?: number; now?: () => number }) {
    this.now = deps.now ?? Date.now;
  }

  async loadStates(): Promise<Map<string, SyncState>> {
    const rows = await this.deps.clickhouse.query<{ symbol: string; dataset: string; first: number | null; synced: number }>(
      `SELECT symbol, dataset, toUnixTimestamp64Milli(first_open_time) AS first, toUnixTimestamp64Milli(synced_to) AS synced
       FROM sync_state FINAL WHERE venue = {venue:String}`,
      { venue: this.deps.venue.id },
    );
    return new Map(rows.map(row => [`${row.symbol}:${row.dataset}`, { firstOpenTime: row.first, syncedTo: row.synced }]));
  }

  /**
   * One pass over `symbols`. With `until`, a symbol still backfilling stops at that time (its
   * checkpoint is kept and `pending` set), so the next pass soon advances every caught-up symbol
   * again: their stored history must not stall behind a sibling's hours-long backfill.
   * A symbol whose every tier is done and whose 1m history is within the venue's sync lag limit
   * (MAX_SYNC_LAG_MS unless it sets one) of now is marked caught up once (`market_caught_up`);
   * the API lists markets only after that.
   */
  async syncAll(symbols: readonly string[], until = Number.POSITIVE_INFINITY): Promise<SyncResult[]> {
    const [states, caughtUp] = await Promise.all([this.loadStates(), this.loadCaughtUp()]);
    const batch = new Batch(this.deps.clickhouse, this.deps.venue.id, this.now);
    const queue = [...symbols];
    const results: SyncResult[] = [];
    const worker = async () => {
      for (let symbol = queue.shift(); symbol; symbol = queue.shift()) {
        const result = await this.syncSymbol(batch, symbol, states, until);
        if (!result.pending && !result.error && !caughtUp.has(symbol) && result.syncedTo >= this.now() - (this.deps.venue.maxSyncLagMs ?? MAX_SYNC_LAG_MS)) {
          caughtUp.add(symbol);
          batch.caughtUp.push({ symbol, at: this.now() });
        }
        results.push(result);
      }
    };
    await Promise.all(Array.from({ length: this.deps.concurrency ?? 8 }, worker));
    await batch.flush();
    return results;
  }

  private async loadCaughtUp(): Promise<Set<string>> {
    const rows = await this.deps.clickhouse.query<{ symbol: string }>(
      "SELECT symbol FROM market_caught_up FINAL WHERE venue = {venue:String}", { venue: this.deps.venue.id });
    return new Set(rows.map(row => row.symbol));
  }

  private async syncSymbol(batch: Batch, symbol: string, states: Map<string, SyncState>, until: number): Promise<SyncResult> {
    const state = (resolution: Resolution) => states.get(`${symbol}:${DATASETS[resolution]}`) ?? { firstOpenTime: null, syncedTo: 0 };
    let rows = 0;
    try {
      const time = this.now() - SETTLE_MS;
      const minutes = await this.syncTier(batch, symbol, "1m", state("1m"), time - (time % MINUTE), until);
      rows += minutes.rows;
      let pending = minutes.pending;
      // Coarser tiers end where the next finer tier's first candle begins.
      let finer = minutes.state.firstOpenTime;
      for (const resolution of this.deps.venue.history.filter(resolution => resolution !== "1m")) {
        if (finer === null || pending) break;
        const tier = await this.syncTier(batch, symbol, resolution, state(resolution), ceil(finer, RESOLUTION_MS[resolution]), until);
        rows += tier.rows;
        pending = tier.pending;
        finer = tier.state.firstOpenTime ?? finer;
      }
      return { symbol, rows, syncedTo: minutes.state.syncedTo, ...(pending ? { pending } : {}) };
    } catch (error) {
      return { symbol, rows, syncedTo: state("1m").syncedTo, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async syncTier(batch: Batch, symbol: string, resolution: Resolution, initial: SyncState, end: number, until: number): Promise<{ rows: number; state: SyncState; pending: boolean }> {
    let state = initial;
    let rows = 0;
    if (state.syncedTo >= end) return { rows, state, pending: false };
    if (state.syncedTo === 0) {
      const earliest = await this.deps.rest.earliest(symbol, resolution);
      if (earliest === null) return { rows, state, pending: false };
      state = { firstOpenTime: null, syncedTo: Math.min(earliest, end) };
    }
    const dataset = DATASETS[resolution];
    let waiting = false;
    while (state.syncedTo < end && this.now() < until) {
      const page = await this.deps.rest.candles(symbol, resolution, state.syncedTo, end);
      // An empty page ending where it began: the venue has nothing settled past `from` yet.
      if (page.coveredTo === state.syncedTo && !page.klines.length) { waiting = true; break; }
      if (page.coveredTo <= state.syncedTo || page.coveredTo > end) throw new Error(`${dataset} page for ${symbol} did not progress`);
      state = { firstOpenTime: state.firstOpenTime ?? page.klines[0]?.openTime ?? null, syncedTo: page.coveredTo };
      rows += page.klines.length;
      for (const kline of page.klines) {
        const row = klineRow(this.deps.venue.id, symbol, kline);
        if (resolution === "1m") batch.minutes.push(row);
        else batch.native.push({ ...row, resolution });
      }
      batch.states.set(`${symbol}:${dataset}`, { symbol, dataset, state });
      if (batch.size >= FLUSH_ROWS) await batch.flush();
    }
    // An empty tier (nothing before the finer tier) is checkpointed too, so it is not re-probed.
    if (state !== initial) batch.states.set(`${symbol}:${dataset}`, { symbol, dataset, state });
    return { rows, state, pending: !waiting && state.syncedTo < end };
  }
}
