import { prop } from "../../json";
import type { ContractLog } from "../../near/neardata";
import { settlementAsset } from "./backfill";
import { VERIFIER } from "./diffs";
import type { ExplorerSwap } from "./explorer";

/** One executed `transfer` intent item: `from` moved `tokens` (raw amounts) to `to` within the verifier. */
export type IntentTransfer = {
  height: number; time: number; txHash: string; receiptId: string;
  intentHash: string; from: string; to: string; tokens: Map<string, bigint>;
};

const UNSIGNED = /^\d{1,78}$/;

/** Every `dip4` transfer of the verifier's logs; malformed ones are reported, never guessed. */
export function transfersFromLogs(logs: readonly ContractLog[], invalid: (detail: string) => void): IntentTransfer[] {
  const transfers: IntentTransfer[] = [];
  for (const log of logs) {
    if (log.account !== VERIFIER || !log.text.startsWith("EVENT_JSON:") || !log.text.includes('"event":"transfer"')) continue;
    try {
      const event: unknown = JSON.parse(log.text.slice("EVENT_JSON:".length));
      const data = prop(event, "data");
      if (prop(event, "standard") !== "dip4" || prop(event, "event") !== "transfer" || !Array.isArray(data)) throw new Error("Unrecognized transfer event");
      for (const entry of data) {
        const intentHash = prop(entry, "intent_hash"), from = prop(entry, "account_id"), to = prop(entry, "receiver_id"), tokens = prop(entry, "tokens");
        if (typeof intentHash !== "string" || typeof from !== "string" || typeof to !== "string" || !from || !to || typeof tokens !== "object" || tokens === null || Array.isArray(tokens)) throw new Error("Invalid transfer");
        const amounts = new Map<string, bigint>();
        for (const [token, amount] of Object.entries(tokens)) {
          if (!token || typeof amount !== "string" || !UNSIGNED.test(amount)) throw new Error(`Invalid transfer amount for ${token}`);
          amounts.set(token, BigInt(amount));
        }
        transfers.push({ height: log.height, time: log.time, txHash: log.txHash, receiptId: log.receiptId, intentHash, from, to, tokens: amounts });
      }
    } catch (error) {
      invalid(`${log.receiptId}: ${error instanceof Error ? error.message : String(error)}: ${log.text.slice(0, 200)}`);
    }
  }
  return transfers;
}

/** A 1Click swap settled by transfers: `account` gave `amountIn` of the origin to `settler` and received `amountOut`. */
export type SettledSwap = {
  /** The (last) block in which the settler paid the destination asset to the account. */
  time: number; height: number; txHash: string;
  account: string; settler: string;
  originAsset: string; amountIn: bigint; destinationAsset: string; amountOut: bigint;
};

export type Settlement = { swap: SettledSwap } | { reason: "no-transfers" | "ambiguous" | "amount-mismatch" };

/**
 * Since late October 2026 1Click settles most swaps through its own settlement account with
 * plain `transfer` intents (no `token_diff`): the swap's deposit account sends the origin asset
 * to it, and it pays the destination asset back (plus, for exact-output swaps, the unused input).
 * Solvers are paid from its inventory separately, so no transfer links a swap to a solver. The
 * swap is the one account pair whose net transfers across the swap's transactions are exactly
 * "origin given, destination received"; with several (a deposit forwarded by the user's own
 * account), the pair of the Explorer deposit address. The input is the Explorer's swapped amount
 * when the account gave at least that much (deposit fees it withheld are not part of the trade).
 */
export function settledSwap(swap: Pick<ExplorerSwap, "originAsset" | "destinationAsset" | "depositAddress" | "amountIn">, transfers: readonly IntentTransfer[]): Settlement {
  const origin = settlementAsset(swap.originAsset), destination = settlementAsset(swap.destinationAsset);
  const flows = new Map<string, { account: string; settler: string; net: Map<string, bigint>; payout: IntentTransfer | undefined }>();
  const flow = (account: string, settler: string) => {
    const key = `${account}\n${settler}`;
    let entry = flows.get(key);
    if (!entry) flows.set(key, entry = { account, settler, net: new Map(), payout: undefined });
    return entry;
  };
  for (const transfer of transfers) {
    if (transfer.from === transfer.to) continue;
    const given = flow(transfer.from, transfer.to), received = flow(transfer.to, transfer.from);
    for (const [token, amount] of transfer.tokens) {
      given.net.set(token, (given.net.get(token) ?? 0n) - amount);
      received.net.set(token, (received.net.get(token) ?? 0n) + amount);
    }
    if ((transfer.tokens.get(destination) ?? 0n) > 0n && (!received.payout || transfer.height >= received.payout.height)) received.payout = transfer;
  }
  const candidates = [...flows.values()].filter(({ net }) => {
    const nonzero = [...net].filter(([, amount]) => amount !== 0n);
    return nonzero.length === 2 && (net.get(origin) ?? 0n) < 0n && (net.get(destination) ?? 0n) > 0n;
  });
  if (!candidates.length) return { reason: "no-transfers" };
  const preferred = candidates.length === 1 ? candidates : candidates.filter(candidate => candidate.account === swap.depositAddress);
  if (preferred.length !== 1) return { reason: "ambiguous" };
  const chosen = preferred[0]!;
  const given = -chosen.net.get(origin)!;
  if (swap.amountIn !== null && (swap.amountIn <= 0n || swap.amountIn > given)) return { reason: "amount-mismatch" };
  const payout = chosen.payout!;
  return {
    swap: {
      time: payout.time, height: payout.height, txHash: payout.txHash, account: chosen.account, settler: chosen.settler,
      originAsset: origin, amountIn: swap.amountIn ?? given, destinationAsset: destination, amountOut: chosen.net.get(destination)!,
    },
  };
}
