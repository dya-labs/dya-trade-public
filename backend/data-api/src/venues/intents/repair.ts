import { DAY, klineRow, MINUTE } from "../../candles/kline";
import type { ClickHouse } from "../../clickhouse";
import { log } from "../../log";
import type { VenueContext, VenueRest } from "../types";
import { recoveredSwap } from "./backfill";
import { updateCoverage } from "./coverage";
import type { IntentsCatalog } from "./catalog";
import { loadIntentsState } from "./indexer";
import { DIFF_COLUMNS, diffFromRow } from "./rows";
import type { DiffRow } from "./rows";
import { BACKFILL_MARGIN_MS, catalogLoader, createIntentsRest, HISTORY_MS } from "./venue";

const HOUR = 60 * MINUTE;
type Gap = { created: number; deposit_address: string; intent_hashes: string[]; origin_asset: string; destination_asset: string };

/** Remove only gaps whose listed executed intents prove the original asset exchange. */
export async function repairIntentsGaps(clickhouse: ClickHouse): Promise<number> {
  const gaps = await clickhouse.query<Gap>("SELECT toUnixTimestamp64Milli(created_at) AS created, deposit_address, intent_hashes, origin_asset, destination_asset FROM intents_gaps FINAL ORDER BY created_at");
  const hashes = [...new Set(gaps.flatMap(gap => gap.intent_hashes))];
  if (!hashes.length) return 0;
  const rows: DiffRow[] = [];
  // Bound each HTTP field well below ClickHouse's 128 KiB default.
  for (let offset = 0; offset < hashes.length; offset += 100) {
    const batch = hashes.slice(offset, offset + 100);
    rows.push(...await clickhouse.query<DiffRow>(`SELECT ${DIFF_COLUMNS} FROM intents_diffs FINAL WHERE intent_hash IN {hashes:Array(String)}`,
      { hashes: `[${batch.map(hash => `'${hash.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`).join(",")}]` }));
  }
  const byHash = Map.groupBy(rows.map(diffFromRow), diff => diff.intentHash);
  let removed = 0;
  for (let offset = 0; offset < gaps.length; offset += 100) {
    const batch = gaps.slice(offset, offset + 100);
    const recovered = batch.filter(gap => recoveredSwap({ intentHashes: gap.intent_hashes, originAsset: gap.origin_asset, destinationAsset: gap.destination_asset },
      gap.intent_hashes.flatMap(hash => byHash.get(hash) ?? [])));
    if (!recovered.length) continue;
    const params: Record<string, string | number> = {};
    const conditions = recovered.map((gap, index) => {
      params[`time${index}`] = gap.created;
      params[`address${index}`] = gap.deposit_address;
      return `(created_at = fromUnixTimestamp64Milli({time${index}:Int64}, 'UTC') AND deposit_address = {address${index}:String})`;
    });
    await clickhouse.command(`ALTER TABLE intents_gaps DELETE WHERE ${conditions.join(" OR ")} SETTINGS mutations_sync = 1`, params, undefined, 600_000);
    removed += recovered.length;
  }
  return removed;
}

/**
 * Repeatable repair. Stop ingest-intents and other Intents sync writers first.
 * Insert replacement versions before pruning obsolete keys; readers retain history throughout.
 * A failed run is repaired by rerunning the same bounds; raw diffs and sync cursors are retained.
 */
export async function repairIntents(context: VenueContext, from: number, to: number, deps: { rest?: VenueRest; catalog?: () => Promise<IntentsCatalog> } = {}): Promise<{ gaps: number; candles: number; hours: number }> {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from % HOUR || to % HOUR || from >= to) throw new Error("Repair bounds must be increasing whole UTC hours");
  const { clickhouse } = context;
  const state = await loadIntentsState(clickhouse);
  if (!state.cursor || state.switchAt === null || to > Math.floor(state.cursor.time / HOUR) * HOUR) throw new Error("Repair ends beyond the stored closed hours");
  const earliest = state.backfill === null ? state.switchAt
    : Math.ceil(Math.max(state.backfill + 2 * HOUR, state.switchAt - HISTORY_MS + 2 * HOUR) / MINUTE) * MINUTE;
  // Whole-hour CLI bounds may contain the partial first supported hour, but no earlier hour.
  if (from < Math.floor(earliest / HOUR) * HOUR) throw new Error("Repair begins before stored history is complete");
  // Once swaps settled by transfers are tracked, the range must lie within their stored history.
  if (state.settlements !== null) {
    if (to > Math.floor(state.settlements / HOUR) * HOUR) throw new Error("Repair ends beyond the stored settled swaps");
    const history = state.settlementsHistory ?? state.settlements;
    if (history > state.switchAt - BACKFILL_MARGIN_MS && from < Math.ceil((history + BACKFILL_MARGIN_MS) / HOUR) * HOUR) throw new Error("Repair begins before stored settled swaps are complete");
  }
  const catalog = deps.catalog ?? catalogLoader();
  const resolved = await catalog();
  const params = { from, to };
  // A strictly greater explicit version wins under each table's ReplacingMergeTree FINAL.
  // Read the server clock and both maxima: host clock skew and same-ms retries are harmless.
  const versions = await clickhouse.query<{ version: number }>(
    `SELECT greatest(toUnixTimestamp64Milli(now64(3)),
      (SELECT toUnixTimestamp64Milli(max(ingested_at)) FROM klines_1m WHERE venue = 'intents'),
      (SELECT toUnixTimestamp64Milli(max(computed_at)) FROM intents_coverage)) + 1 AS version`);
  const version = Number(versions[0]?.version);
  if (!Number.isSafeInteger(version)) throw new Error("Cannot establish repair version");
  const source = deps.rest ?? createIntentsRest(context, { catalog: async () => resolved });
  const markets = await source.instruments();
  const gaps = await repairIntentsGaps(clickhouse);
  let candles = 0;
  for (let day = from; day < to; day += DAY) {
    const started = performance.now(), previousCandles = candles;
    const end = Math.min(day + DAY, to);
    for (const market of markets) {
      let position = Math.max(day, earliest);
      while (position < end) {
        const page = await source.candles(market.symbol, "1m", position, end);
        if (page.coveredTo <= position || page.coveredTo > end) throw new Error(`Repair could not advance ${market.symbol} at ${new Date(position).toISOString()}`);
        await clickhouse.insert("klines_1m", page.klines.map(bar => ({ ...klineRow("intents", market.symbol, bar), ingested_at: String(version) })));
        candles += page.klines.length;
        position = page.coveredTo;
      }
    }
    log("intents.repair.day", { from: new Date(day).toISOString(), to: new Date(end).toISOString(), candles, dayCandles: candles - previousCandles, elapsedMs: Math.round(performance.now() - started) });
  }
  let hours = 0;
  for (let day = Math.max(from, Math.ceil(earliest / HOUR) * HOUR); day < to; day += DAY) {
    hours += await updateCoverage(clickhouse, resolved, { cursor: { time: Math.min(day + DAY, to) }, switchAt: day, backfill: null }, version);
  }
  // Only after every derivation succeeds: remove stale keys/versions, never the new rows.
  // Merges may already have discarded superseded versions; predicates work either way.
  const cleanup = { ...params, version };
  await clickhouse.command("ALTER TABLE klines_1m DELETE WHERE venue = 'intents' AND open_time >= fromUnixTimestamp64Milli({from:Int64}, 'UTC') AND open_time < fromUnixTimestamp64Milli({to:Int64}, 'UTC') AND ingested_at < fromUnixTimestamp64Milli({version:Int64}, 'UTC') SETTINGS mutations_sync = 1", cleanup, undefined, 600_000);
  await clickhouse.command("ALTER TABLE intents_coverage DELETE WHERE hour >= fromUnixTimestamp64Milli({from:Int64}, 'UTC') AND hour < fromUnixTimestamp64Milli({to:Int64}, 'UTC') AND computed_at < fromUnixTimestamp64Milli({version:Int64}, 'UTC') SETTINGS mutations_sync = 1", cleanup, undefined, 600_000);
  const firsts = new Map((await clickhouse.query<{ symbol: string; first: number }>(
    "SELECT symbol, min(toUnixTimestamp64Milli(open_time)) AS first FROM klines_1m FINAL WHERE venue = 'intents' GROUP BY symbol")).map(row => [row.symbol, row.first]));
  const checkpoints = await clickhouse.query<{ symbol: string; synced: number }>(
    "SELECT symbol, toUnixTimestamp64Milli(synced_to) AS synced FROM sync_state FINAL WHERE venue = 'intents' AND dataset = 'klines_1m'");
  await clickhouse.insert("sync_state", checkpoints.map(row => ({
    venue: "intents", symbol: row.symbol, dataset: "klines_1m", first_open_time: firsts.has(row.symbol) ? String(firsts.get(row.symbol)) : null,
    synced_to: String(row.synced), updated_at: String(Date.now()),
  })));
  return { gaps, candles, hours };
}
