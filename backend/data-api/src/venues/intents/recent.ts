import { DAY } from "../../candles/kline";
import type { ClickHouse } from "../../clickhouse";
import type { IntentsCatalog } from "./catalog";
import { historicalRates, marketTrade } from "./pricing";
import { diffFromRow, DIFF_COLUMNS, type DiffRow } from "./rows";
import { recentSettlements } from "./settlements";
import { receiptTrades, settlementTrades, SERVICE_REFERRALS } from "./trades";

/** `txHash` is the NEAR transaction holding the trade. */
export type RecentTrade = { time: number; price: string; quantity: string; side: "buy" | "sell"; txHash: string };

/**
 * The market's newest charted trades of the last day, newest first, derived and priced exactly
 * like its candles. A quote asset's newest stored close prices trades after it (carried up to an
 * hour), so the latest few may differ slightly from the settled candle.
 */
export async function recentTrades(clickhouse: ClickHouse, catalog: IntentsCatalog, symbol: string, limit: number, now = Date.now()): Promise<RecentTrade[] | undefined> {
  const market = catalog.markets.get(symbol);
  if (!market) return undefined;
  const list = (values: Iterable<string>) => `[${[...values].map(id => `'${id.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`).join(",")}]`;
  const assetIds = catalog.assetIds(market.group);
  // Only receipts with a 1Click user intent can chart a trade (`receiptTrades`); solver-only and
  // 1Click's own receipts would otherwise fill the candidate limit and leave the list short.
  const [rows, settlements] = await Promise.all([clickhouse.query<DiffRow>(
    `SELECT ${DIFF_COLUMNS} FROM intents_diffs FINAL
     WHERE block_time >= fromUnixTimestamp64Milli({from:Int64}, 'UTC') AND receipt_id IN (
       SELECT receipt_id FROM intents_diffs
       WHERE block_time >= fromUnixTimestamp64Milli({from:Int64}, 'UTC')
       GROUP BY receipt_id
       HAVING max(hasAny(tokens, {ids:Array(String)})) AND countIf(referral != '' AND NOT has({service:Array(String)}, referral)) > 0
       ORDER BY max(block_time) DESC LIMIT {receipts:UInt32})
     ORDER BY block_time DESC, receipt_id, log_index, item`,
    { from: now - DAY, ids: list(assetIds), service: list(SERVICE_REFERRALS), receipts: limit * 2 }), recentSettlements(clickhouse, assetIds, now - DAY, limit * 2)]);
  const receipts = [...Map.groupBy(rows.map(diffFromRow), diff => diff.receiptId).values()];
  const derived = [
    ...receipts.map(diffs => ({ time: diffs[0]!.time, txHash: diffs[0]!.txHash, trades: receiptTrades(diffs, catalog.resolve).trades })),
    ...settlements.map(settlement => ({ time: settlement.time, txHash: settlement.txHash, trades: settlementTrades(settlement, catalog.resolve).trades })),
  ];
  if (!derived.length) return [];
  const groups = new Set(derived.flatMap(entry => entry.trades.flatMap(trade => [trade.sold.group, trade.bought.group])));
  const rates = await historicalRates(clickhouse, catalog.quotes, groups, Math.min(...derived.map(entry => entry.time)), now + 60_000);
  const trades: RecentTrade[] = [];
  for (const entry of derived) {
    for (const route of entry.trades) {
      const trade = marketTrade(route, market.group, entry.time, group => rates.at(group, entry.time));
      if (trade && trade !== "unpriced") trades.push({ time: trade.time, price: trade.price, quantity: trade.quantity, side: trade.takerBuy ? "buy" : "sell", txHash: entry.txHash });
    }
  }
  return trades.sort((a, b) => b.time - a.time).slice(0, limit);
}
