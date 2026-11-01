import type { ClickHouse } from "../../clickhouse";
import { log } from "../../log";
import { USD, type IntentsCatalog } from "./catalog";
import { diffFromRow, DIFF_COLUMNS, type DiffRow } from "./rows";
import { storedSettlements } from "./settlements";
import { receiptTrades, settlementTrades, type ReceiptTrades } from "./trades";

const HOUR = 3_600_000;
// Hours computed per pass, so a long history catches up without a long ClickHouse query.
const HOURS_PER_PASS = 24;

type CoverageState = { cursor: { time: number } | null; switchAt: number | null; backfill: number | null; settlements?: number | null };

/**
 * Computes `intents_coverage` for each closed hour that is fully stored: from the backfill
 * position (plus two hours of execution lag) or the switch minute, to the cursor (and, when
 * `settlementsTracked`, the settled-swaps watermark). Receipts and settled swaps count by
 * derivation status. A trade counts as unpriced when neither side is a stablecoin nor has an
 * exchange market.
 */
export async function updateCoverage(clickhouse: ClickHouse, catalog: IntentsCatalog, state: CoverageState, repairVersion?: number, settlementsTracked = false): Promise<number> {
  if (!state.cursor || state.switchAt === null) return 0;
  const start = Math.ceil((state.backfill === null ? state.switchAt : state.backfill + 2 * HOUR) / HOUR) * HOUR;
  let end = Math.floor(state.cursor.time / HOUR) * HOUR;
  if (settlementsTracked) end = state.settlements == null ? start : Math.min(end, Math.floor(state.settlements / HOUR) * HOUR);
  const done = new Set(repairVersion === undefined ? (await clickhouse.query<{ start: number }>(
    "SELECT DISTINCT toUnixTimestamp64Milli(hour) AS start FROM intents_coverage WHERE hour >= fromUnixTimestamp64Milli({start:Int64}, 'UTC')", { start })).map(row => Number(row.start)) : []);
  const priced = (group: string) => group === USD || catalog.quotes.has(group);
  let computed = 0;
  for (let hour = start; hour < end && computed < HOURS_PER_PASS; hour += HOUR) {
    if (done.has(hour)) continue;
    const [rows, settlements] = await Promise.all([clickhouse.query<DiffRow>(
      `SELECT ${DIFF_COLUMNS} FROM intents_diffs FINAL
       WHERE block_time >= fromUnixTimestamp64Milli({from:Int64}, 'UTC') AND block_time < fromUnixTimestamp64Milli({to:Int64}, 'UTC')
       ORDER BY block_time, receipt_id, log_index, item`, { from: hour, to: hour + HOUR }), storedSettlements(clickhouse, hour, hour + HOUR)]);
    const totals = new Map<string, { receipts: number; trades: number; unpriced: number }>();
    const count = ({ status, trades }: ReceiptTrades) => {
      const entry = totals.get(status) ?? { receipts: 0, trades: 0, unpriced: 0 };
      entry.receipts++;
      entry.trades += trades.length;
      entry.unpriced += trades.filter(trade => !priced(trade.sold.group) && !priced(trade.bought.group)).length;
      totals.set(status, entry);
    };
    for (const diffs of Map.groupBy(rows.map(diffFromRow), diff => diff.receiptId).values()) count(receiptTrades(diffs, catalog.resolve));
    for (const settlement of settlements) count(settlementTrades(settlement, catalog.resolve));
    // An hour without receipts still gets a row, so it isn't computed again.
    if (!totals.size) totals.set("none", { receipts: 0, trades: 0, unpriced: 0 });
    await clickhouse.insert("intents_coverage", [...totals].map(([status, entry]) => ({ hour: String(hour), status, ...entry, ...(repairVersion === undefined ? {} : { computed_at: String(repairVersion) }) })));
    computed++;
  }
  if (computed) log("intents.coverage", { hours: computed });
  return computed;
}
