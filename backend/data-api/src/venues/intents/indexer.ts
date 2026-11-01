import type { ClickHouse } from "../../clickhouse";
import { loadNearState, type NearSource, type NearState } from "../../near/indexer";
import { diffRow, diffsFromLogs, isTokenDiffLog, VERIFIER, type IntentDiff } from "./diffs";

/** The verifier's token_diff events for the shared NEAR indexer. */
export const intentsSource: NearSource<IntentDiff> = {
  id: "intents",
  accounts: new Set([VERIFIER]),
  matches: isTokenDiffLog,
  rowsTable: "intents_diffs",
  stateTable: "intents_state",
  parse: diffsFromLogs,
  row: diffRow,
};

/**
 * Indexer state plus `backfill`: the oldest Explorer creation time whose swaps are all stored;
 * `settlements`: before it, every settled swap's payout is stored (`IntentsSettlements`, live);
 * `settlementsHistory`: the oldest creation time whose settled swaps are all stored.
 */
export type IntentsState = NearState & { backfill: number | null; settlements: number | null; settlementsHistory: number | null };

export async function loadIntentsState(clickhouse: ClickHouse): Promise<IntentsState> {
  const [near, rows] = await Promise.all([
    loadNearState(clickhouse, intentsSource.stateTable),
    clickhouse.query<{ key: string; time: number }>(`SELECT key, toUnixTimestamp64Milli(time) AS time FROM ${intentsSource.stateTable} FINAL WHERE key IN ('backfill', 'settlements', 'settlements_history')`),
  ]);
  const time = (key: string) => { const row = rows.find(entry => entry.key === key); return row ? Number(row.time) : null; };
  return { ...near, backfill: time("backfill"), settlements: time("settlements"), settlementsHistory: time("settlements_history") };
}
