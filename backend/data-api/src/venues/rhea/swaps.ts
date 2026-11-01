import { prop } from "../../json";
import type { ContractLog } from "../../near/neardata";

/** Rhea's classic pools (Ref v2) and concentrated-liquidity (DCL) pools. */
export const RHEA_CONTRACTS: Record<string, "classic" | "dcl"> = { "v2.ref-finance.near": "classic", "dclv2.ref-labs.near": "dcl" };

/** One hop through one pool. Amounts are raw token integers. */
export type Swap = {
  height: number; time: number; txHash: string; receiptId: string; logIndex: number;
  contract: "classic" | "dcl"; poolId: string; tokenIn: string; tokenOut: string; amountIn: bigint; amountOut: bigint;
};

const ACCOUNT = /^[a-z0-9._-]{2,64}$/;
// Ref v2: `Swapped 25391351537387689956343808 wrap.near for 10634844 zec.omft.near`; stable and
// rated pools append `, total fee <n>, admin fee <n>`.
const CLASSIC = /^Swapped (\d+) ([a-z0-9._-]{2,64}) for (\d+) ([a-z0-9._-]{2,64})(?:, total fee \d+, admin fee \d+)?$/;

function account(value: unknown): string {
  if (typeof value !== "string" || !ACCOUNT.test(value)) throw new Error(`Invalid account id: ${String(value)}`);
  return value;
}
function amount(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value)) throw new Error(`Invalid amount: ${String(value)}`);
  return BigInt(value);
}

/** True for the logs `swapsFromLogs` reads; every other Rhea log (fees, liquidity, shares) is ignored. */
export function isSwapLog(log: Pick<ContractLog, "account" | "text">): boolean {
  const contract = RHEA_CONTRACTS[log.account];
  return contract === "classic" ? log.text.startsWith("Swapped ") : contract === "dcl" && log.text.startsWith("EVENT_JSON:") && log.text.includes('"event":"swap"');
}

/**
 * Swaps in receipt-log order. `logIndex` counts swap logs within each receipt (a DCL event's
 * items add `* 100 + item`), so a replay of the same logs yields the same keys. Swaps with a
 * zero amount move nothing and are dropped. Malformed swap logs are reported, never guessed.
 */
export function swapsFromLogs(logs: readonly ContractLog[], invalid: (detail: string) => void): Swap[] {
  const seen = new Map<string, number>();
  const swaps: Swap[] = [];
  for (const log of logs) {
    if (!isSwapLog(log)) continue;
    const index = seen.get(log.receiptId) ?? 0;
    seen.set(log.receiptId, index + 1);
    const base = { height: log.height, time: log.time, txHash: log.txHash, receiptId: log.receiptId };
    try {
      if (RHEA_CONTRACTS[log.account] === "classic") {
        const match = CLASSIC.exec(log.text);
        if (!match) throw new Error("Unrecognized swap log");
        const swap: Swap = { ...base, logIndex: index * 100, contract: "classic", poolId: "", tokenIn: match[2]!, amountIn: BigInt(match[1]!), tokenOut: match[4]!, amountOut: BigInt(match[3]!) };
        if (swap.amountIn > 0n && swap.amountOut > 0n) swaps.push(swap);
        continue;
      }
      const event: unknown = JSON.parse(log.text.slice("EVENT_JSON:".length));
      const data = prop(event, "data");
      if (prop(event, "standard") !== "dcl.ref" || prop(event, "event") !== "swap" || !Array.isArray(data)) throw new Error("Unrecognized DCL event");
      data.forEach((item: unknown, position) => {
        const poolId = prop(item, "pool_id");
        if (typeof poolId !== "string" || !poolId) throw new Error("Missing DCL pool id");
        const swap: Swap = { ...base, logIndex: index * 100 + position, contract: "dcl", poolId, tokenIn: account(prop(item, "token_in")), amountIn: amount(prop(item, "amount_in")), tokenOut: account(prop(item, "token_out")), amountOut: amount(prop(item, "amount_out")) };
        if (swap.amountIn > 0n && swap.amountOut > 0n) swaps.push(swap);
      });
    } catch (error) {
      invalid(`${log.receiptId}: ${error instanceof Error ? error.message : String(error)}: ${log.text.slice(0, 200)}`);
    }
  }
  return swaps;
}

