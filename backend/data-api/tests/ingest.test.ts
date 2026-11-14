import { describe, expect, test } from "bun:test";
import { BinanceRest } from "../src/binance/rest";
import type { ClickHouse } from "../src/clickhouse";
import { KlineSync } from "../src/ingest/sync";
import type { VenueRest } from "../src/venues/types";

const START = Date.parse("2026-10-12T00:00:00Z");

function clock(start = START) {
  let now = start;
  const sleeps: number[] = [];
  return { now: () => now, sleep: async (ms: number) => { sleeps.push(ms); now += ms; }, advance: (ms: number) => { now += ms; }, sleeps };
}

const row = (openTime: number) => [openTime, "1.00000000", "1.00000000", "1.00000000", "1.00000000", "1.00000000", openTime + 59_999, "1.00000000", 1, "0.00000000", "0.00000000", "0"];

describe("Binance REST weight budget", () => {
  test("waits for the next minute when the local budget is spent", async () => {
    const time = clock();
    const rest = new BinanceRest({ url: "https://binance.test", weightBudget: 4, now: time.now, sleep: time.sleep, fetcher: (async () => Response.json([])) as unknown as typeof fetch });
    await rest.klines("BTCUSDT", 0, 1);
    await rest.klines("BTCUSDT", 0, 1);
    expect(time.sleeps).toEqual([]);
    await rest.klines("BTCUSDT", 0, 1);
    expect(time.sleeps).toEqual([60_100]);
  });

  test("adopts the venue-reported IP usage, which includes other processes", async () => {
    const time = clock();
    const fetcher = async () => Response.json([], { headers: { "x-mbx-used-weight-1m": "2999" } });
    const rest = new BinanceRest({ url: "https://binance.test", weightBudget: 3000, now: time.now, sleep: time.sleep, fetcher: fetcher as unknown as typeof fetch });
    await rest.klines("BTCUSDT", 0, 1);
    await rest.klines("BTCUSDT", 0, 1);
    expect(time.sleeps).toHaveLength(1);
  });

  test("a 429 pauses every later request for at least Retry-After", async () => {
    const time = clock();
    const responses = [new Response("", { status: 429, headers: { "retry-after": "120" } }), Response.json([])];
    const rest = new BinanceRest({ url: "https://binance.test", weightBudget: 3000, now: time.now, sleep: time.sleep, fetcher: (async () => responses.shift()!) as unknown as typeof fetch });
    await expect(rest.klines("BTCUSDT", 0, 1)).rejects.toMatchObject({ status: 429 });
    await rest.klines("ETHUSDT", 0, 1);
    expect(time.sleeps[0]).toBe(120_000);
  });

  test("an invalid request does not pause other symbols", async () => {
    const time = clock();
    const responses = [new Response("", { status: 400 }), Response.json([])];
    const rest = new BinanceRest({ url: "https://binance.test", weightBudget: 3000, now: time.now, sleep: time.sleep, fetcher: (async () => responses.shift()!) as unknown as typeof fetch });
    await expect(rest.klines("NOPE", 0, 1)).rejects.toMatchObject({ status: 400 });
    await rest.klines("ETHUSDT", 0, 1);
    expect(time.sleeps).toEqual([]);
  });
});

/** Records inserts; optionally fails one insert to simulate a ClickHouse outage. `caughtUp`: symbols already marked. */
function fakeClickHouse(failInsert?: number, caughtUp: string[] = []) {
  const inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
  let calls = 0;
  const clickhouse = {
    query: async (sql: string) => sql.includes("market_caught_up") ? caughtUp.map(symbol => ({ symbol })) : [],
    insert: async (table: string, rows: Record<string, unknown>[]) => {
      if (++calls === failInsert) throw new Error("ClickHouse down");
      inserts.push({ table, rows });
    },
  };
  return { clickhouse: clickhouse as unknown as ClickHouse, inserts };
}

describe("checkpointed sync", () => {
  test("backfills from the first minute, pages forward, and stops at the last settled minute", async () => {
    const time = clock(START + 2500 * 60_000 + 30_000);
    const first = START + 7 * 60_000;
    const requests: { start: number; end: number }[] = [];
    const fetcher = async (url: URL | string) => {
      const params = new URL(String(url)).searchParams;
      const start = Number(params.get("startTime")), end = Number(params.get("endTime"));
      requests.push({ start, end });
      const rows = [];
      for (let open = Math.max(start, first); open <= end && rows.length < 1000; open += 60_000) rows.push(row(open));
      return Response.json(rows);
    };
    const rest = new BinanceRest({ url: "https://binance.test", weightBudget: 3000, now: time.now, sleep: time.sleep, fetcher: fetcher as unknown as typeof fetch });
    const { clickhouse, inserts } = fakeClickHouse();
    const [result] = await new KlineSync({ clickhouse, rest, venue: { id: "binance", history: ["1m"] }, now: time.now }).syncAll(["BTCUSDT"]);
    const end = START + 2500 * 60_000;
    expect(result).toEqual({ symbol: "BTCUSDT", rows: 2493, syncedTo: end });
    // The first request finds the venue's earliest minute; paging then starts there.
    expect(requests.map(request => request.start)).toEqual([0, first, first + 1000 * 60_000, first + 2000 * 60_000]);
    expect(requests.slice(1).every(request => request.end === end - 1)).toBe(true);
    // Rows, then the checkpoint, then the one-time caught-up mark that lets the API list it.
    expect(inserts.filter(insert => insert.rows.length).map(insert => insert.table)).toEqual(["klines_1m", "sync_state", "market_caught_up"]);
    expect(inserts.find(insert => insert.table === "market_caught_up")!.rows).toEqual([{ venue: "binance", symbol: "BTCUSDT", caught_up_at: String(time.now()) }]);
    expect(inserts.find(insert => insert.table === "sync_state")!.rows[0]).toMatchObject({ first_open_time: String(first), synced_to: String(end) });
  });

  test("a failed row insert never advances the checkpoint", async () => {
    const time = clock(START + 5 * 60_000 + 30_000);
    const rest = new BinanceRest({ url: "https://binance.test", weightBudget: 3000, now: time.now, sleep: time.sleep, fetcher: (async () => Response.json([row(START)])) as unknown as typeof fetch });
    const { clickhouse, inserts } = fakeClickHouse(1);
    const sync = new KlineSync({ clickhouse, rest, venue: { id: "binance", history: ["1m"] }, now: time.now });
    await expect(sync.syncAll(["BTCUSDT"])).rejects.toThrow("ClickHouse down");
    expect(inserts.filter(insert => insert.table === "sync_state")).toEqual([]);
  });

  test("short-retention venues store native 1h up to the first 1m hour and 1d up to the first 1h day", async () => {
    const HOUR = 3_600_000, DAY = 24 * HOUR;
    const now = START + 10 * DAY + 30_000;
    const first = { "1m": START + 3 * DAY + 90 * 60_000, "1h": START + DAY + 5 * HOUR, "1d": START - 400 * DAY };
    const calls: string[] = [];
    const bar = (openTime: number) => ({ openTime, open: "1", high: "1", low: "1", close: "1", volume: "1", quoteVolume: "1", trades: 0, takerBuyVolume: "0", takerBuyQuoteVolume: "0" });
    const rest: VenueRest = {
      instruments: async () => [],
      nativeCandles: async () => [],
      earliest: async (_symbol, resolution) => first[resolution],
      candles: async (_symbol, resolution, from, to) => {
        calls.push(`${resolution} ${new Date(from).toISOString()} ${new Date(to).toISOString()}`);
        const step = resolution === "1m" ? 60_000 : resolution === "1h" ? HOUR : DAY;
        const klines = [];
        for (let open = from; open < to; open += step) klines.push(bar(open));
        return { klines, coveredTo: to };
      },
    };
    const { clickhouse, inserts } = fakeClickHouse();
    await new KlineSync({ clickhouse, rest, venue: { id: "gate", history: ["1m", "1h", "1d"] }, now: () => now }).syncAll(["RHEA_USDT"]);
    expect(calls).toEqual([
      `1m ${new Date(first["1m"]).toISOString()} ${new Date(START + 10 * DAY).toISOString()}`,
      // 1h ends at the first whole 1m hour; 1d ends at the first whole 1h day.
      `1h ${new Date(first["1h"]).toISOString()} ${new Date(START + 3 * DAY + 2 * HOUR).toISOString()}`,
      `1d ${new Date(first["1d"]).toISOString()} ${new Date(START + 2 * DAY).toISOString()}`,
    ]);
    const states = inserts.filter(insert => insert.table === "sync_state").flatMap(insert => insert.rows);
    expect(states.map(state => [state.dataset, state.first_open_time])).toEqual([
      ["klines_1m", String(first["1m"])], ["klines_1h", String(first["1h"])], ["klines_1d", String(first["1d"])],
    ]);
    expect(inserts.find(insert => insert.table === "klines_native")!.rows.filter(row => row.resolution === "1d")).toHaveLength(402);
  });

  test("a pass deadline parks a long backfill so caught-up siblings keep advancing", async () => {
    let now = START + 10 * 60_000 + 30_000;
    const first = { OLD: START - 365 * 24 * 3_600_000, NEW: START };
    const rest: VenueRest = {
      instruments: async () => [],
      nativeCandles: async () => [],
      earliest: async symbol => first[symbol === "OLD" ? "OLD" : "NEW"],
      // Every page costs a second of wall time and covers 100 minutes.
      candles: async (_symbol, _resolution, from, to) => { now += 1000; return { klines: [], coveredTo: Math.min(to, from + 100 * 60_000) }; },
    };
    const { clickhouse } = fakeClickHouse();
    const sync = new KlineSync({ clickhouse, rest, venue: { id: "okx", history: ["1m"] }, concurrency: 2, now: () => now });
    const results = await sync.syncAll(["OLD", "NEW"], now + 30_000);
    const end = START + 10 * 60_000;
    expect(results.find(result => result.symbol === "NEW")).toEqual({ symbol: "NEW", rows: 0, syncedTo: end });
    const old = results.find(result => result.symbol === "OLD")!;
    expect(old.pending).toBe(true);
    expect(old.syncedTo).toBeLessThan(end);
  });

  test("only a finished, current market is marked caught up, and only once", async () => {
    let now = START + 10 * 60_000 + 30_000;
    // FAR is a year behind (still backfilling); LAG finished its pages but its venue is 20 minutes
    // behind; DONE is current; SEEN is current and was marked before.
    const settled: Record<string, number> = { LAG: START - 10 * 60_000 };
    const rest: VenueRest = {
      instruments: async () => [],
      nativeCandles: async () => [],
      earliest: async symbol => symbol === "FAR" ? START - 365 * 24 * 3_600_000 : START,
      candles: async (symbol, _resolution, from, to) => {
        now += 1000;
        const limit = settled[symbol] ?? to;
        return { klines: [], coveredTo: Math.max(from, Math.min(to, limit, from + 100 * 60_000)) };
      },
    };
    const { clickhouse, inserts } = fakeClickHouse(undefined, ["SEEN"]);
    await new KlineSync({ clickhouse, rest, venue: { id: "rhea", history: ["1m"] }, now: () => now }).syncAll(["FAR", "LAG", "DONE", "SEEN"], now + 5000);
    expect(inserts.filter(insert => insert.table === "market_caught_up").flatMap(insert => insert.rows.map(row => row.symbol))).toEqual(["DONE"]);
  });

  test("a venue with nothing settled yet ends the pass without an error or a backfill flag", async () => {
    const now = START + 10 * 60_000 + 30_000;
    // Settled through minute 3 only, like an indexer whose cursor is behind the clock.
    const settled = START + 3 * 60_000;
    const rest: VenueRest = {
      instruments: async () => [],
      nativeCandles: async () => [],
      earliest: async () => START,
      candles: async (_symbol, _resolution, from, to) => ({ klines: [], coveredTo: Math.max(from, Math.min(to, settled)) }),
    };
    const { clickhouse, inserts } = fakeClickHouse();
    const [result] = await new KlineSync({ clickhouse, rest, venue: { id: "rhea", history: ["1m"] }, now: () => now }).syncAll(["X"], now + 30_000);
    expect(result).toEqual({ symbol: "X", rows: 0, syncedTo: settled });
    expect(inserts.find(entry => entry.table === "sync_state")?.rows[0]).toMatchObject({ synced_to: String(settled) });
  });
});
