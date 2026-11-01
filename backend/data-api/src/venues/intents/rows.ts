import type { IntentDiff } from "./diffs";

/** `intents_diffs` columns as `DiffRow` fields, amounts as decimal strings. */
export const DIFF_COLUMNS = `toUnixTimestamp64Milli(block_time) AS time, block_height AS height, tx_hash AS tx, receipt_id AS receipt, log_index AS logIndex, item,
  intent_hash AS intent, account_id AS account, referral, tokens, arrayMap(x -> toString(x), amounts) AS amounts,
  fee_tokens AS feeTokens, arrayMap(x -> toString(x), fees) AS fees, version`;

export type DiffRow = {
  time: number; height: number; tx: string; receipt: string; logIndex: number; item: number; intent: string; account: string; referral: string;
  tokens: string[]; amounts: string[]; feeTokens: string[]; fees: string[]; version: string;
};

export function diffFromRow(row: DiffRow): IntentDiff {
  return {
    height: Number(row.height), time: Number(row.time), txHash: row.tx, receiptId: row.receipt, logIndex: Number(row.logIndex), item: Number(row.item),
    intentHash: row.intent, account: row.account, referral: row.referral,
    diff: new Map(row.tokens.map((token, index) => [token, BigInt(row.amounts[index]!)])),
    fees: new Map(row.feeTokens.map((token, index) => [token, BigInt(row.fees[index]!)])), version: row.version,
  };
}
