import { RedisClient } from "bun";
import { prop } from "../json";
import { log } from "../log";
import { blockHeader, blockLogs, NeardataError, neardataGet, type BlockHeader, type ContractLog, type Neardata } from "./neardata";

/** One finalized block's indexed logs. Heights that produced no block have no entry. */
export type BlockEntry = BlockHeader & { logs: ContractLog[] };

/** The shared stream of finalized blocks the NEAR indexers read, oldest first. */
export type NearBlocks = {
  last(): Promise<BlockEntry | null>;
  append(entry: BlockEntry): Promise<void>;
  /** Entries above `height`, oldest first, waiting up to `waitMs` for the first one. */
  after(height: number, count: number, waitMs: number): Promise<BlockEntry[]>;
  close(): void;
};

const STREAM = "near:blocks";
/** The feed's heartbeat, read by its healthcheck. */
export const FEED_STATUS_KEY = "near:feed:status";
/**
 * `keyed`: a FastNEAR key is configured. `error`: the neardata failure since the last delivered
 * batch, with its HTTP status (or error name) and since when; null while blocks arrive.
 */
export type FeedStatus = { at: number; keyed: boolean; height: number | null; time: number | null; error: { status: number | string; since: number } | null };
// About 8 hours of blocks at 1.67 a second, ~40 MB (about 826 bytes a block). An
// indexer further behind than this re-reads the gap from neardata itself.
export const RETAINED_BLOCKS = 50_000;

/** Entry fields: prev height, block time, and logs as [txHash, receiptId, account, text] tuples. */
function decode(id: string, fields: string[]): BlockEntry {
  const values = new Map<string, string>();
  for (let index = 0; index + 1 < fields.length; index += 2) values.set(fields[index]!, fields[index + 1]!);
  const height = Number(id.split("-")[0]), prev = Number(values.get("prev")), time = Number(values.get("time"));
  const tuples: unknown = JSON.parse(values.get("logs") ?? "null");
  if (!Number.isSafeInteger(height) || !Number.isSafeInteger(prev) || !Number.isFinite(time) || !Array.isArray(tuples)) throw new Error(`Invalid ${STREAM} entry ${id}`);
  const logs = tuples.map((tuple: unknown): ContractLog => {
    const [txHash, receiptId, account, text]: unknown[] = Array.isArray(tuple) ? tuple : [];
    if (typeof txHash !== "string" || typeof receiptId !== "string" || typeof account !== "string" || typeof text !== "string") throw new Error(`Invalid ${STREAM} log in ${id}`);
    return { height, time, txHash, receiptId, account, text };
  });
  return { height, prev, time, logs };
}

function entries(reply: unknown): BlockEntry[] {
  if (!Array.isArray(reply)) return [];
  return reply.map((item: unknown) => {
    if (!Array.isArray(item) || typeof item[0] !== "string" || !Array.isArray(item[1])) throw new Error(`Invalid ${STREAM} reply`);
    return decode(item[0], item[1]);
  });
}

/** `NearBlocks` in a Valkey stream whose entry ids are block heights. Blocking reads hold this client. */
export function valkeyNearBlocks(redisUrl: string): NearBlocks {
  const redis = new RedisClient(redisUrl);
  return {
    async last() {
      return entries(await redis.send("XREVRANGE", [STREAM, "+", "-", "COUNT", "1"]))[0] ?? null;
    },
    async append(entry) {
      const logs = JSON.stringify(entry.logs.map(item => [item.txHash, item.receiptId, item.account, item.text]));
      await redis.send("XADD", [STREAM, "MAXLEN", "~", String(RETAINED_BLOCKS), `${entry.height}-0`, "prev", String(entry.prev), "time", String(entry.time), "logs", logs]);
    },
    async after(height, count, waitMs) {
      const reply: unknown = await redis.send("XREAD", ["COUNT", String(count), "BLOCK", String(waitMs), "STREAMS", STREAM, `${height}-0`]);
      return entries(prop(reply, STREAM));
    },
    close: () => redis.close(),
  };
}

// Behind the chain, this many blocks are requested at once; at its head, one at a time (neardata
// holds a request for the next height open until that block is final).
const CATCHUP_BATCH = 8;
const BEHIND_MS = 30_000;
const RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;
const STATUS_MS = 5_000;

export type FeedDeps = {
  neardata: Neardata;
  blocks: NearBlocks;
  redis: RedisClient;
  /** Contracts whose logs the indexers read, and which of their logs to keep. */
  accounts: ReadonlySet<string>;
  keep(log: ContractLog): boolean;
  /** Where an empty stream starts: the lowest indexer cursor, or null for the chain head. */
  start(): Promise<number | null>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Follows neardata's finalized blocks and appends each block's kept logs to the shared stream,
 * so every block is fetched once however many indexers read it. It resumes after the stream's
 * newest entry; an empty stream (Valkey restarted) starts at the lowest indexer cursor, at most
 * RETAINED_BLOCKS behind the head.
 */
export class NearBlockFeed {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private stopped = false;
  private last: BlockHeader | null = null;
  private statusAt = 0;
  private error: FeedStatus["error"] = null;

  constructor(private readonly deps: FeedDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? Bun.sleep;
  }

  stop(): void { this.stopped = true; }

  private async head(): Promise<BlockHeader> {
    return blockHeader(await neardataGet(this.deps.neardata, "/v0/last_block/final"));
  }

  private async resume(): Promise<number> {
    const newest = await this.deps.blocks.last();
    if (newest) {
      this.last = newest;
      return newest.height + 1;
    }
    const [start, head] = await Promise.all([this.deps.start(), this.head()]);
    const from = start === null ? head.height : Math.max(start, head.height - RETAINED_BLOCKS);
    log("near.feed.start", { from, head: head.height });
    return from;
  }

  private async publish(force: boolean): Promise<void> {
    const now = this.now();
    if (!force && now - this.statusAt < STATUS_MS) return;
    this.statusAt = now;
    const status: FeedStatus = { at: now, keyed: !!this.deps.neardata.apiKey, height: this.last?.height ?? null, time: this.last?.time ?? null, error: this.error };
    // Outlives the longest retry backoff, so a failing feed reports its error instead of vanishing.
    await this.deps.redis.set(FEED_STATUS_KEY, JSON.stringify(status), "EX", 180);
  }

  async run(): Promise<void> {
    let retry = RETRY_MS;
    let next: number | null = null;
    while (!this.stopped) {
      try {
        next ??= await this.resume();
        const from = next;
        const behind = this.last === null || this.now() - this.last.time > BEHIND_MS;
        const heights = Array.from({ length: behind ? CATCHUP_BATCH : 1 }, (_, index) => from + index);
        const blocks = await Promise.all(heights.map(height => neardataGet(this.deps.neardata, `/v0/block/${height}`)));
        for (const block of blocks) {
          if (block !== null) {
            const header = blockHeader(block);
            // A height neardata called empty that wasn't: the indexers see the jump and re-read it.
            if (this.last && header.prev > this.last.height) log("near.feed.gap", { after: this.last.height, prev: header.prev }, "warn");
            await this.deps.blocks.append({ ...header, logs: blockLogs(block, this.deps.accounts).filter(this.deps.keep) });
            this.last = header;
          }
          next++;
        }
        this.error = null;
        await this.publish(false);
        retry = RETRY_MS;
      } catch (error) {
        log("near.feed.retry", { height: next, error: String(error) }, "warn");
        const status = error instanceof NeardataError ? error.status : error instanceof Error ? error.name : "error";
        this.error = { status, since: this.error?.since ?? this.now() };
        // Resume from the stream again: an append may have landed even though it reported an error.
        next = null;
        await this.publish(true).catch(() => {});
        await this.sleep(retry);
        retry = Math.min(retry * 2, MAX_RETRY_MS);
      }
    }
  }
}
