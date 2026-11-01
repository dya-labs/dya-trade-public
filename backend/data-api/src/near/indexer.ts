import type { ClickHouse } from "../clickhouse";
import { log } from "../log";
import type { BlockEntry, NearBlocks } from "./feed";
import { blockHeader, blockLogs, neardataGet, type ContractLog, type Neardata } from "./neardata";

const MINUTE = 60_000;
const FLUSH_MS = 2_000;
// NEAR finalizes about 1.67 blocks a second and the feed delivers them ~2.3 s after block time;
// a minute without a new block means data isn't flowing.
const LIVE_MS = 60_000;
// Older blocks are history being caught up: stored, never published as live trades.
const RECENT_MS = 120_000;
const READ_COUNT = 500;
const READ_WAIT_MS = 5_000;
const RETRY_MS = 5_000;

export type BlockPoint = { height: number; time: number };
/** `cursor`: the last block whose rows are all stored; `switchAt`: the first whole minute covered. */
export type NearState = { cursor: BlockPoint | null; switchAt: number | null };

/** What one indexer reads, parses and stores. */
export type NearSource<Row> = {
  /** Log event prefix, e.g. "rhea". */
  id: string;
  /** Contracts whose logs `parse` reads. */
  accounts: ReadonlySet<string>;
  /** True for the logs `parse` reads; the shared feed keeps only these. */
  matches(log: Pick<ContractLog, "account" | "text">): boolean;
  rowsTable: string;
  stateTable: string;
  /** Rows in receipt-log order; replaying the same logs yields the same keys. Malformed logs are reported, never guessed. */
  parse(logs: readonly ContractLog[], invalid: (detail: string) => void): Row[];
  row(row: Row): Record<string, unknown>;
};

export async function loadNearState(clickhouse: ClickHouse, table: string): Promise<NearState> {
  const rows = await clickhouse.query<{ key: string; height: number; time: number }>(
    `SELECT key, height, toUnixTimestamp64Milli(time) AS time FROM ${table} FINAL`);
  const cursor = rows.find(row => row.key === "cursor");
  const switchAt = rows.find(row => row.key === "switch");
  return { cursor: cursor ? { height: Number(cursor.height), time: Number(cursor.time) } : null, switchAt: switchAt ? Number(switchAt.time) : null };
}

export type IndexerDeps = {
  clickhouse: ClickHouse;
  /** The shared stream of finalized blocks (see `NearBlockFeed`). */
  blocks: NearBlocks;
  /** Where blocks missing from the stream are re-read. */
  neardata: Neardata;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type IndexerSink<Row> = {
  /** Rows of recent blocks, in block order (caught-up history is stored only). */
  rows(rows: Row[]): void;
  connected(connected: boolean): void;
  invalid(detail: string): void;
};

/**
 * Stores every row of a source's contract logs and keeps a cursor: the last block whose rows
 * are all stored.
 *
 * Blocks come from the shared feed stream in height order, each naming the block before it. A
 * block whose predecessor is past the cursor means blocks are missing from the stream (the
 * cursor is older than its retained blocks, or the feed restarted on an empty stream); those are
 * re-read from neardata before the cursor moves on, so it never skips a block. The first block
 * ever read fixes `switchAt`, the first whole minute whose rows are all stored.
 */
export class NearLogIndexer<Row> {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private state: NearState = { cursor: null, switchAt: null };
  private persisted: NearState = { cursor: null, switchAt: null };
  private buffer: Row[] = [];
  /** The first block ever read, fixed with `switchAt` on the first run. */
  private switchHeight: number | null = null;
  /** Block time of the newest block read; data is live while it's recent (see `report`). */
  private lastBlockTime: number | null = null;
  /** What the sink was last told. */
  private live = false;
  private stopped = false;
  private reading: Promise<void> = Promise.resolve();
  private timer: Timer | undefined;
  private flushing: Promise<void> = Promise.resolve();

  constructor(private readonly source: NearSource<Row>, private readonly deps: IndexerDeps, private readonly sink: IndexerSink<Row>) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? Bun.sleep;
  }

  get current(): NearState { return this.persisted; }

  async load(): Promise<void> {
    this.state = await loadNearState(this.deps.clickhouse, this.source.stateTable);
    this.persisted = { ...this.state };
  }

  async start(): Promise<void> {
    await this.load();
    this.timer = setInterval(() => void this.tick(), FLUSH_MS);
    this.reading = this.read();
  }

  async close(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.reading;
    await this.tick();
  }

  private async read(): Promise<void> {
    while (!this.stopped) {
      try {
        const entries = await this.deps.blocks.after(this.state.cursor?.height ?? 0, READ_COUNT, READ_WAIT_MS);
        for (const entry of entries) {
          if (this.stopped) break;
          await this.take(entry);
        }
        this.report();
      } catch (error) {
        log(`${this.source.id}.read.failed`, { error: String(error) }, "error");
        await this.sleep(RETRY_MS);
      }
    }
  }

  /** Reads one block from the stream, first re-reading any blocks between the cursor and it. */
  async take(entry: BlockEntry): Promise<void> {
    const cursor = this.state.cursor;
    if (!cursor) {
      // First run: nothing before this block is owed; candles switch at the next whole minute.
      this.state = { cursor: { height: entry.prev, time: entry.time - 1 }, switchAt: Math.ceil(entry.time / MINUTE) * MINUTE };
      this.switchHeight = entry.height;
      log(`${this.source.id}.switch`, { height: entry.height, switchAt: new Date(this.state.switchAt!).toISOString() });
    } else if (entry.height <= cursor.height) {
      return;
    } else if (entry.prev > cursor.height) {
      await this.repair(cursor.height + 1, entry.prev);
      if (this.stopped) return;
    }
    const rows = this.source.parse(entry.logs, detail => this.sink.invalid(detail));
    this.buffer.push(...rows);
    this.state = { ...this.state, cursor: { height: entry.height, time: entry.time } };
    this.lastBlockTime = entry.time;
    if (rows.length && this.now() - entry.time <= RECENT_MS) this.sink.rows(rows);
  }

  /**
   * Tells the sink the stream is connected only while recent blocks keep arriving, so the
   * health check sees one outage for a stalled or lagging feed and stays down while history catches up.
   */
  private report(): void {
    const live = this.lastBlockTime !== null && this.now() - this.lastBlockTime <= LIVE_MS;
    if (live === this.live) return;
    this.live = live;
    this.sink.connected(live);
  }

  /** Stores rows read so far, then the cursor that covers them. */
  async tick(): Promise<void> {
    this.report();
    await this.flush();
  }

  private flush(): Promise<void> {
    const rows = this.buffer, state = this.state;
    this.buffer = [];
    this.flushing = this.flushing.catch(() => {}).then(async () => {
      try {
        await this.deps.clickhouse.insert(this.source.rowsTable, rows.map(this.source.row));
      } catch (error) {
        // Keep the rows and the old cursor; the next flush retries both.
        this.buffer.unshift(...rows);
        throw error;
      }
      const updates = [];
      if (state.switchAt !== null && this.persisted.switchAt === null) updates.push({ key: "switch", height: this.switchHeight, time: String(state.switchAt) });
      if (state.cursor && state.cursor.height !== this.persisted.cursor?.height) updates.push({ key: "cursor", height: state.cursor.height, time: String(state.cursor.time) });
      if (updates.length) await this.deps.clickhouse.insert(this.source.stateTable, updates);
      this.persisted = state;
    });
    return this.flushing.catch(error => log(`${this.source.id}.flush.failed`, { error: String(error) }, "error"));
  }

  /** Re-reads blocks [from, to] from neardata, storing their rows and advancing the cursor. */
  private async repair(from: number, to: number): Promise<void> {
    const id = this.source.id;
    log(`${id}.repair.start`, { from, to, blocks: to - from + 1 });
    for (let height = from; height <= to && !this.stopped;) {
      let block: unknown;
      try {
        block = await neardataGet(this.deps.neardata, `/v0/block/${height}`);
      } catch (error) {
        log(`${id}.repair.retry`, { height, error: String(error) }, "warn");
        await this.sleep(RETRY_MS);
        continue;
      }
      // null: a height that produced no block.
      const time = block === null ? this.state.cursor!.time : blockHeader(block).time;
      if (block !== null) this.buffer.push(...this.source.parse(blockLogs(block, this.source.accounts), detail => this.sink.invalid(detail)));
      this.state = { ...this.state, cursor: { height, time } };
      height++;
    }
    log(`${id}.repair.done`, { from, to, cursor: this.state.cursor?.height });
  }
}
