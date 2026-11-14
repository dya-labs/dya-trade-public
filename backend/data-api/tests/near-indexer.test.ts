import { describe, expect, test } from "bun:test";
import type { ClickHouse } from "../src/clickhouse";
import type { BlockEntry, NearBlocks } from "../src/near/feed";
import { NearLogIndexer } from "../src/near/indexer";
import { rheaSource } from "../src/venues/rhea/indexer";

const T0 = 1_791_987_840_000; // a whole minute
const ns = (ms: number) => `${BigInt(ms) * 1_000_000n}`;
const swap = (height: number, time: number, receipt: string) => ({
  height, time, txHash: `tx-${receipt}`, receiptId: receipt, account: "v2.ref-finance.near", text: `Swapped 1000 wrap.near for ${height} blackdragon.tkn.near`,
});
const entry = (height: number, prev: number, time: number, receipts: string[] = []): BlockEntry => ({ height, prev, time, logs: receipts.map(receipt => swap(height, time, receipt)) });
const neardataBlock = (height: number, prev: number, time: number, status: object) => ({
  block: { header: { height, prev_height: prev, timestamp_nanosec: ns(time) } },
  shards: [{ receipt_execution_outcomes: [{ tx_hash: `tx-${height}`, execution_outcome: { id: `r-${height}`, outcome: { executor_id: "v2.ref-finance.near", status, logs: [`Swapped 7 wrap.near for ${height} blackdragon.tkn.near`] } } }] }],
});
const unusedBlocks: NearBlocks = { last: async () => null, append: async () => {}, after: async () => [], close: () => {} };

function harness(stored: { key: string; height: number; time: number }[] = [], blocks: Record<number, unknown> = {}, failInsert?: number) {
  let now = T0;
  const inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
  const fetched: number[] = [];
  let calls = 0;
  const clickhouse = {
    query: async () => stored,
    insert: async (table: string, rows: Record<string, unknown>[]) => {
      if (!rows.length) return;
      if (++calls === failInsert) throw new Error("ClickHouse down");
      inserts.push({ table, rows });
    },
  } as unknown as ClickHouse;
  const fetcher = (async (input: string | URL | Request) => {
    const height = Number(String(input).split("/").at(-1));
    fetched.push(height);
    return Response.json(blocks[height] ?? null);
  }) as typeof fetch;
  const live: number[] = [];
  const reported: boolean[] = [];
  const indexer = new NearLogIndexer(rheaSource,
    { clickhouse, blocks: unusedBlocks, neardata: { url: "https://neardata.invalid", apiKey: "key", fetcher }, now: () => now, sleep: async () => {} },
    { rows: swaps => live.push(...swaps.map(row => row.height)), connected: value => reported.push(value), invalid: detail => { throw new Error(detail); } },
  );
  const rows = (table: string) => inserts.filter(item => item.table === table).flatMap(item => item.rows);
  const cursor = () => rows("rhea_state").filter(row => row.key === "cursor").at(-1)?.height;
  return { indexer, inserts, fetched, live, reported, rows, cursor, advance: (ms: number) => { now += ms; } };
}

describe("NEAR indexer cursor (Rhea source)", () => {
  test("first run fixes the switch minute at the first block read and stores swaps before the cursor that covers them", async () => {
    const h = harness();
    await h.indexer.load();
    h.advance(3000);
    await h.indexer.take(entry(100, 99, T0 + 1500, ["a"]));
    await h.indexer.take(entry(102, 100, T0 + 2700, ["b"])); // 101 produced no block
    await h.indexer.tick();
    expect(h.rows("rhea_state").find(row => row.key === "switch")).toMatchObject({ height: 100, time: String(T0 + 60_000) });
    expect(h.cursor()).toBe(102);
    const order = h.inserts.map(item => item.table === "rhea_swaps" ? "swaps" : `state:${item.rows.map(row => row.height).join()}`);
    expect(order).toEqual(["swaps", "state:100,102"]);
    expect(h.live).toEqual([100, 102]);
    expect(h.fetched).toEqual([]);
  });

  test("blocks at or below the cursor are skipped, so a replayed stream stores nothing twice", async () => {
    const h = harness([{ key: "cursor", height: 200, time: T0 }, { key: "switch", height: 150, time: T0 - 60_000 }]);
    await h.indexer.load();
    await h.indexer.take(entry(199, 198, T0 - 600, ["old"]));
    await h.indexer.take(entry(200, 199, T0, ["same"]));
    await h.indexer.take(entry(201, 200, T0 + 600, ["new"]));
    await h.indexer.tick();
    expect(h.rows("rhea_swaps").map(row => row.receipt_id)).toEqual(["new"]);
    expect(h.cursor()).toBe(201);
  });

  test("blocks missing from the stream are re-read from neardata before the cursor moves past them", async () => {
    const h = harness([{ key: "cursor", height: 200, time: T0 }, { key: "switch", height: 150, time: T0 - 60_000 }], {
      201: neardataBlock(201, 200, T0 + 800, { SuccessValue: "" }),
      // 202 is a skipped height (null); 203's receipt failed, so its logged swap was reverted.
      203: neardataBlock(203, 201, T0 + 2400, { Failure: {} }),
    });
    await h.indexer.load();
    await h.indexer.take(entry(204, 203, T0 + 3200, ["c"]));
    await h.indexer.tick();
    expect(h.fetched).toEqual([201, 202, 203]);
    expect(h.rows("rhea_swaps").map(row => row.block_height)).toEqual([201, 204]);
    expect(h.cursor()).toBe(204);
    expect(h.rows("rhea_state").some(row => row.key === "switch")).toBe(false);
    // Repaired history is stored, never published as live trades.
    expect(h.live).toEqual([204]);
  });

  test("reports connected only while recent blocks arrive: a stalled feed and catch-up are one outage", async () => {
    const h = harness([{ key: "cursor", height: 300, time: T0 - 3_600_000 }]);
    await h.indexer.load();
    await h.indexer.tick();
    expect(h.reported).toEqual([]);
    // Catching up an hour-old backlog: stored, not live.
    await h.indexer.take(entry(301, 300, T0 - 3_000_000, ["old"]));
    await h.indexer.tick();
    expect(h.reported).toEqual([]);
    expect(h.live).toEqual([]);
    await h.indexer.take(entry(302, 301, T0 - 2000, ["fresh"]));
    await h.indexer.tick();
    expect(h.reported).toEqual([true]);
    expect(h.live).toEqual([302]);
    h.advance(60_001);
    await h.indexer.tick();
    expect(h.reported).toEqual([true, false]);
  });

  test("a failed insert keeps the cursor back and retries the swaps", async () => {
    const h = harness([{ key: "cursor", height: 400, time: T0 }], {}, 1);
    await h.indexer.load();
    await h.indexer.take(entry(401, 400, T0 + 800, ["e"]));
    await h.indexer.tick();
    expect(h.cursor()).toBeUndefined();
    await h.indexer.tick();
    expect(h.rows("rhea_swaps").map(row => row.block_height)).toEqual([401]);
    expect(h.cursor()).toBe(401);
  });
});
