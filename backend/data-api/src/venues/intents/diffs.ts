import { prop } from "../../json";
import type { ContractLog } from "../../near/neardata";

/** The NEAR Intents verifier. */
export const VERIFIER = "intents.near";

/** One executed `token_diff` intent. Amounts are raw signed token integers (negative: given). */
export type IntentDiff = {
  height: number; time: number; txHash: string; receiptId: string;
  /** Position among the receipt's token_diff logs, and of the intent within that log's data. */
  logIndex: number; item: number;
  intentHash: string; account: string;
  /** 1Click's mark on its users' intents; empty for solvers. */
  referral: string;
  diff: Map<string, bigint>;
  fees: Map<string, bigint>;
  version: string;
};

const SIGNED = /^-?\d{1,78}$/;
const UNSIGNED = /^\d{1,78}$/;

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Invalid ${field}`);
  return value;
}

function amounts(value: unknown, pattern: RegExp, field: string): Map<string, bigint> {
  if (value === undefined) return new Map();
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Invalid ${field}`);
  const result = new Map<string, bigint>();
  for (const [token, amount] of Object.entries(value)) {
    if (!token || typeof amount !== "string" || !pattern.test(amount)) throw new Error(`Invalid ${field} for ${token}`);
    result.set(token, BigInt(amount));
  }
  return result;
}

/** True for the logs `diffsFromLogs` reads; every other verifier event is ignored. */
export function isTokenDiffLog(log: Pick<ContractLog, "account" | "text">): boolean {
  return log.account === VERIFIER && log.text.startsWith("EVENT_JSON:") && log.text.includes('"event":"token_diff"');
}

/**
 * Intents in receipt-log order, keyed by (receipt, token_diff log position, item) so a replay of
 * the same logs yields the same keys. Malformed token_diff logs are reported, never guessed.
 */
export function diffsFromLogs(logs: readonly ContractLog[], invalid: (detail: string) => void): IntentDiff[] {
  const seen = new Map<string, number>();
  const diffs: IntentDiff[] = [];
  for (const log of logs) {
    if (!isTokenDiffLog(log)) continue;
    const logIndex = seen.get(log.receiptId) ?? 0;
    seen.set(log.receiptId, logIndex + 1);
    try {
      const event: unknown = JSON.parse(log.text.slice("EVENT_JSON:".length));
      const data = prop(event, "data"), version = prop(event, "version");
      if (prop(event, "standard") !== "dip4" || prop(event, "event") !== "token_diff" || !Array.isArray(data) || typeof version !== "string") throw new Error("Unrecognized token_diff event");
      const parsed = data.map((entry: unknown, item): IntentDiff => {
        const referral = prop(entry, "referral");
        const diff = amounts(prop(entry, "diff"), SIGNED, "diff");
        if (!diff.size) throw new Error("Empty diff");
        return {
          height: log.height, time: log.time, txHash: log.txHash, receiptId: log.receiptId, logIndex, item,
          intentHash: text(prop(entry, "intent_hash"), "intent_hash"), account: text(prop(entry, "account_id"), "account_id"),
          referral: referral === undefined || referral === null ? "" : text(referral, "referral"),
          diff, fees: amounts(prop(entry, "fees_collected"), UNSIGNED, "fees_collected"), version,
        };
      });
      diffs.push(...parsed);
    } catch (error) {
      invalid(`${log.receiptId}: ${error instanceof Error ? error.message : String(error)}: ${log.text.slice(0, 200)}`);
    }
  }
  return diffs;
}

export function diffRow(diff: IntentDiff) {
  return {
    block_time: String(diff.time), receipt_id: diff.receiptId, log_index: diff.logIndex, item: diff.item,
    block_height: diff.height, tx_hash: diff.txHash, intent_hash: diff.intentHash, account_id: diff.account, referral: diff.referral,
    tokens: [...diff.diff.keys()], amounts: [...diff.diff.values()].map(String),
    fee_tokens: [...diff.fees.keys()], fees: [...diff.fees.values()].map(String), version: diff.version,
  };
}
