import { expect, test } from "bun:test";
import { kline } from "../src/candles/kline";
import type { ClickHouse } from "../src/clickhouse";
import type { VenueContext, VenueRest } from "../src/venues/types";
import type { IntentsCatalog } from "../src/venues/intents/catalog";
import { repairIntents, repairIntentsGaps } from "../src/venues/intents/repair";
import type { DiffRow } from "../src/venues/intents/rows";

const FROM = Date.parse("2026-10-01T00:00:00Z"), TO = FROM + 3_600_000;
const catalog: IntentsCatalog = { resolve: () => undefined, assetIds: () => [], markets: new Map(), quotes: new Map(), stablecoins: new Set() };

test("credential-free repair inserts winners before pruning stale versions, retains checkpoints, and can rerun", async () => {
  const commands: string[] = [];
  let candles: Record<string, unknown>[] = [{ obsolete: true, ingested_at: "1" }];
  let coverage: Record<string, unknown>[] = [{ obsolete: true, computed_at: "1" }];
  let version = FROM;
  let fail = false;
  const clickhouse = {
    query: async (sql: string) => {
      if (sql.includes("AS version")) return [{ version: ++version }];
      if (sql.includes("'backfill'")) return [{ key: "backfill", time: FROM - 7_200_000 }];
      if (sql.includes("FROM intents_state")) return [{ key: "cursor", height: 1, time: TO + 60_000 }, { key: "switch", height: 1, time: TO }];
      if (sql.includes("FROM intents_coverage")) return coverage;
      if (sql.includes("FROM sync_state")) return [{ symbol: "A_USD", synced: TO }];
      if (sql.includes("FROM klines_1m")) return [{ symbol: "A_USD", first: FROM + 60_000 }];
      return [];
    },
    command: async (sql: string, params: Record<string, string | number>) => {
      commands.push(sql);
      expect(candles.some(row => Number(row.ingested_at) === version)).toBe(true);
      expect(coverage.some(row => Number(row.computed_at) === version)).toBe(true);
      expect(params.version).toBe(version);
      if (sql.includes("ALTER TABLE klines_1m")) {
        expect(sql).toContain("AND ingested_at <");
        candles = candles.filter(row => Number(row.ingested_at) >= version);
      }
      if (sql.includes("ALTER TABLE intents_coverage")) {
        expect(sql).toContain("AND computed_at <");
        coverage = coverage.filter(row => Number(row.computed_at) >= version);
      }
    },
    insert: async (table: string, rows: Record<string, unknown>[]) => {
      if (table === "klines_1m") {
        expect(candles.length).toBeGreaterThan(0);
        candles.push(...rows);
      }
      else if (table === "intents_coverage") coverage.push(...rows);
      else if (table === "sync_state") expect(rows).toEqual([{ venue: "intents", symbol: "A_USD", dataset: "klines_1m", first_open_time: String(FROM + 60_000), synced_to: String(TO), updated_at: expect.any(String) }]);
      else throw new Error(`Unexpected repair write ${table}`);
    },
  } as unknown as ClickHouse;
  const bar = kline({ openTime: FROM + 60_000, open: "1", high: "1", low: "1", close: "1", volume: "2", quoteVolume: "2", trades: 1, takerBuyVolume: "0", takerBuyQuoteVolume: "0" });
  const rest: VenueRest = {
    instruments: async () => [{ symbol: "A_USD", base: "A", quote: "USD", status: "TRADING" }],
    earliest: async () => { throw new Error("Credential-dependent earliest must not be used"); },
    nativeCandles: async () => { throw new Error("Repair must derive candles, not request native candles"); },
    candles: async (_symbol: string, _resolution: string, from: number, to: number) => {
      expect(from).toBe(FROM);
      if (fail) throw new Error("interrupted");
      return { klines: [bar], coveredTo: to };
    },
  };
  const context = { clickhouse } as VenueContext;
  const deps = { rest, catalog: async () => catalog };
  expect(await repairIntents(context, FROM, TO, deps)).toEqual({ gaps: 0, candles: 1, hours: 1 });
  expect(candles).toHaveLength(1);
  const first = candles.map(({ ingested_at: _version, ...row }) => row);
  expect(await repairIntents(context, FROM, TO, deps)).toEqual({ gaps: 0, candles: 1, hours: 1 });
  expect(candles.map(({ ingested_at: _version, ...row }) => row)).toEqual(first);
  const beforeFailure = JSON.stringify(candles);
  const cleanups = commands.length;
  fail = true;
  await expect(repairIntents(context, FROM, TO, deps)).rejects.toThrow("interrupted");
  expect(JSON.stringify(candles)).toBe(beforeFailure);
  expect(commands).toHaveLength(cleanups);
  expect(commands.every(sql => sql.includes("mutations_sync = 1"))).toBe(true);
  expect(commands.some(sql => sql.includes("intents_diffs") || sql.includes("sync_state"))).toBe(false);
});

test("history repair rejects invalid or unclosed bounds before deleting anything", async () => {
  const clickhouse = {
    query: async (sql: string) => sql.includes("'backfill'") ? [] : [{ key: "cursor", height: 1, time: TO - 1 }, { key: "switch", height: 1, time: FROM }],
    command: async () => { throw new Error("must not mutate"); },
  } as unknown as ClickHouse;
  const context = { clickhouse } as VenueContext;
  await expect(repairIntents(context, FROM + 1, TO)).rejects.toThrow("whole UTC hours");
  await expect(repairIntents(context, FROM, TO)).rejects.toThrow("stored closed hours");
});

test("repair refuses unsupported historical hours before any mutation, regardless of credentials", async () => {
  const clickhouse = {
    query: async (sql: string) => sql.includes("'backfill'") ? [] : [{ key: "cursor", height: 1, time: TO + 60_000 }, { key: "switch", height: 1, time: TO }],
    command: async () => { throw new Error("must not mutate"); },
    insert: async () => { throw new Error("must not insert"); },
  } as unknown as ClickHouse;
  await expect(repairIntents({ clickhouse } as VenueContext, FROM, TO)).rejects.toThrow("before stored history is complete");
});

test("gap repair preserves all same-hash legs and deletes only proven gap identities", async () => {
  const gaps = [
    { created: FROM, deposit_address: "recovered", intent_hashes: ["main", "unexecuted"], origin_asset: "a", destination_asset: "b" },
    { created: FROM, deposit_address: "gas-only", intent_hashes: ["gas"], origin_asset: "a", destination_asset: "b" },
  ];
  const diff = (intent: string, tokens: string[], amounts: string[], logIndex: number): DiffRow => ({
    time: FROM, height: 1, tx: "tx", receipt: "receipt", logIndex, item: 0, intent, account: "user", referral: "1click-test",
    tokens, amounts, feeTokens: [], fees: [], version: "0.4.3",
  });
  const rows = [diff("main", ["a", "b"], ["-100000000000000000000", "100"], 0), diff("main", ["b", "gas-token"], ["-1", "2"], 1), diff("gas", ["b", "gas-token"], ["-1", "2"], 2)];
  const deleted: Record<string, string | number>[] = [];
  const clickhouse = {
    query: async (sql: string, params: Record<string, string | number>) => {
      if (sql.includes("FROM intents_gaps")) return gaps;
      expect(params.hashes).toBe("['main','unexecuted','gas']");
      return rows;
    },
    command: async (_sql: string, params: Record<string, string | number>) => { deleted.push(params); },
  } as unknown as ClickHouse;
  expect(await repairIntentsGaps(clickhouse)).toBe(1);
  expect(deleted).toEqual([{ time0: FROM, address0: "recovered" }]);
});

test("gap hash HTTP parameters are escaped and bounded for large histories", async () => {
  const hashes = ["quote'and\\slash", ...Array.from({ length: 3100 }, (_, index) => `${index}`.padStart(44, "h"))];
  const values: string[] = [];
  const clickhouse = {
    query: async (sql: string, params: Record<string, string | number>) => {
      if (sql.includes("FROM intents_gaps")) return [{ created: FROM, deposit_address: "d", intent_hashes: hashes, origin_asset: "a", destination_asset: "b" }];
      values.push(String(params.hashes));
      return [];
    },
    command: async () => { throw new Error("No recovered gaps"); },
  } as unknown as ClickHouse;
  expect(await repairIntentsGaps(clickhouse)).toBe(0);
  expect(values).toHaveLength(32);
  expect(values[0]).toStartWith("['quote\\'and\\\\slash',");
  expect(values.every(value => value.length < 5000)).toBe(true);
});
