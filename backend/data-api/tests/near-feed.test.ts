import { describe, expect, test } from "bun:test";
import type { RedisClient } from "bun";
import { NearBlockFeed, RETAINED_BLOCKS, type BlockEntry, type FeedStatus, type NearBlocks } from "../src/near/feed";
import { NeardataError, neardataGet } from "../src/near/neardata";
import { rheaSource } from "../src/venues/rhea/indexer";

const T0 = 1_791_987_840_000;
const ns = (ms: number) => `${BigInt(ms) * 1_000_000n}`;
const block = (height: number, prev: number, logs: { account: string; text: string }[] = []) => ({
  block: { header: { height, prev_height: prev, timestamp_nanosec: ns(T0 + height) } },
  shards: [{ receipt_execution_outcomes: logs.map((entry, index) => ({ tx_hash: `tx-${height}-${index}`, execution_outcome: { id: `r-${height}-${index}`, outcome: { executor_id: entry.account, status: { SuccessValue: "" }, logs: [entry.text] } } })) }],
});

function memoryBlocks(initial: BlockEntry[] = []): NearBlocks & { entries: BlockEntry[] } {
  const entries = [...initial];
  return {
    entries,
    last: async () => entries.at(-1) ?? null,
    append: async entry => { entries.push(entry); },
    after: async height => entries.filter(entry => entry.height > height),
    close: () => {},
  };
}

/** A feed over scripted neardata blocks; it stops once it asks for a height past `end`. The first `reject` block requests get 403. */
function harness(blocks: Record<number, unknown>, head: unknown, end: number, store: NearBlocks, start: number | null, reject = 0) {
  const requests: { url: string; auth: string | null }[] = [];
  const published: FeedStatus[] = [];
  let feed: NearBlockFeed | undefined;
  let clock = T0 + 3_600_000;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, auth: new Headers(init?.headers).get("authorization") });
    if (url.endsWith("/v0/last_block/final")) return Response.json(head);
    if (reject-- > 0) return new Response("Forbidden", { status: 403 });
    const height = Number(url.split("/").at(-1));
    if (height > end) feed?.stop();
    return Response.json(blocks[height] ?? null);
  }) as typeof fetch;
  const redis = { set: async (_key: string, value: string) => { published.push(JSON.parse(value)); return "OK"; } } as unknown as RedisClient;
  feed = new NearBlockFeed({
    neardata: { url: "https://neardata.invalid", apiKey: "secret-key", fetcher }, blocks: store, redis,
    accounts: rheaSource.accounts, keep: entry => rheaSource.matches(entry), start: async () => start,
    // Each reading advances 10 s, so status heartbeats aren't throttled away.
    now: () => (clock += 10_000), sleep: async () => {},
  });
  return { feed, requests, published, heights: () => requests.filter(request => !request.url.endsWith("/final")).map(request => Number(request.url.split("/").at(-1))) };
}

describe("NEAR block feed", () => {
  test("appends each produced block once with only the logs the indexers parse, and resumes after the newest entry", async () => {
    const swap = { account: "v2.ref-finance.near", text: "Swapped 1000 wrap.near for 5 blackdragon.tkn.near" };
    const blocks = {
      1000: block(1000, 999, [swap, { account: "v2.ref-finance.near", text: "Liquidity added [...]" }, { account: "other.near", text: "Swapped 1 a for 2 b" }]),
      // 1001 produced no block.
      1002: block(1002, 1000),
      1003: block(1003, 1002, [swap]),
    };
    const store = memoryBlocks();
    const first = harness(blocks, block(1003, 1002), 1003, store, 1000);
    await first.feed.run();
    expect(store.entries.map(entry => [entry.height, entry.prev, entry.logs.map(log => log.text)])).toEqual([
      [1000, 999, [swap.text]],
      [1002, 1000, []],
      [1003, 1002, [swap.text]],
    ]);
    // The key travels in the Authorization header, never in a URL.
    expect(first.requests.every(request => request.auth === "Bearer secret-key" && !request.url.includes("secret-key"))).toBe(true);

    const second = harness({ 1004: block(1004, 1003) }, block(1004, 1003), 1004, store, 1000);
    await second.feed.run();
    expect(second.heights()[0]).toBe(1004);
    expect(second.requests.some(request => request.url.endsWith("/final"))).toBe(false);
    expect(store.entries.map(entry => entry.height)).toEqual([1000, 1002, 1003, 1004]);
  });

  test("an empty stream starts at the lowest indexer cursor, at most RETAINED_BLOCKS behind the head", async () => {
    const head = 200_000;
    const behind = harness({}, block(head, head - 1), 0, memoryBlocks(), 5);
    await behind.feed.run();
    expect(behind.heights()[0]).toBe(head - RETAINED_BLOCKS);

    const fresh = harness({}, block(head, head - 1), 0, memoryBlocks(), null);
    await fresh.feed.run();
    expect(fresh.heights()[0]).toBe(head);
  });

  test("a rejected key is published with its HTTP status until blocks arrive again", async () => {
    const store = memoryBlocks([{ height: 1000, prev: 999, time: T0 + 1000, logs: [] }]);
    const h = harness({ 1001: block(1001, 1000), 1002: block(1002, 1001) }, block(1002, 1001), 1002, store, null, 8);
    await h.feed.run();
    expect(h.published[0]).toMatchObject({ keyed: true, height: 1000, error: { status: 403 } });
    expect(h.published.at(-1)).toMatchObject({ height: 1002, error: null });
    expect(store.entries.map(entry => entry.height)).toEqual([1000, 1001, 1002]);
  });
});

describe("neardata requests", () => {
  test("follow archive redirects within neardata with the key, and refuse redirects elsewhere", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
      if (url === "https://neardata.invalid/v0/block/5") return new Response(null, { status: 302, headers: { location: "https://a2.neardata.invalid/v0/block/5" } });
      if (url === "https://neardata.invalid/v0/block/6") return new Response(null, { status: 302, headers: { location: "https://elsewhere.example/v0/block/6" } });
      return Response.json(block(5, 4));
    }) as typeof fetch;
    const neardata = { url: "https://neardata.invalid", apiKey: "secret-key", fetcher };
    expect(await neardataGet(neardata, "/v0/block/5")).toEqual(block(5, 4));
    expect(seen.map(request => [request.url, request.auth])).toEqual([
      ["https://neardata.invalid/v0/block/5", "Bearer secret-key"],
      ["https://a2.neardata.invalid/v0/block/5", "Bearer secret-key"],
    ]);
    await expect(neardataGet(neardata, "/v0/block/6")).rejects.toBeInstanceOf(NeardataError);
    expect(seen.some(request => request.url.startsWith("https://elsewhere.example"))).toBe(false);
  });
});
