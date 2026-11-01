import { prop } from "../../json";
import { log } from "../../log";
import type { ContractLog } from "../../near/neardata";
import { VERIFIER } from "./diffs";

export const EXPLORER_URL = "https://explorer.near-intents.org/api/v0/transactions";
export const FASTNEAR_TX_URL = "https://tx.main.fastnear.com/v0/transactions";
// Explorer: 1 request every 5 s per partner (enforced), at most 1,000 rows each (larger pages
// get 400). FastNEAR's free tier: about 60 requests a minute of at most 20 transactions, then 429
// for a few seconds. With a FastNEAR subscription key: 150 requests at 5.6/s without a 429
// (advertised 10,000 a minute), so keyed requests go
// unpaced, several at once. An invalid key is silently served as free tier.
const EXPLORER_PACE_MS = 5_500;
const FASTNEAR_BATCH = 20;
const FASTNEAR_PACE_MS = 1_000;
const FASTNEAR_KEYED_CONCURRENCY = 8;
const RETRY_MS = 5_000;
export const EXPLORER_PAGE = 1000;

/** One 1Click swap as the Explorer lists it. `amountIn` is the raw origin amount it swapped. */
export type ExplorerSwap = {
  createdAt: number; status: string; depositAddress: string;
  /** The deposit address with its memo, if any: with `createdAt`, the swap's identity. */
  deposit: string;
  intentHashes: string[]; nearTxHashes: string[];
  originAsset: string; destinationAsset: string; amountIn: bigint | null;
  /** Partner (app) fees in basis points of the input, summed; 1Click keeps them off-chain. Null when malformed. */
  appFeeBps: number | null; referral: string;
};

const UNSIGNED = /^\d{1,78}$/;

export function explorerSwaps(page: unknown): ExplorerSwap[] {
  if (!Array.isArray(page)) throw new Error("Invalid Explorer page");
  return page.map(row => {
    const createdAt = Date.parse(String(prop(row, "createdAt"))), hashes = prop(row, "nearTxHashes"), intents = prop(row, "intentHashes");
    if (!Number.isFinite(createdAt) || !Array.isArray(hashes)) throw new Error("Invalid Explorer row");
    const amountIn = prop(row, "amountIn"), fees = prop(row, "appFees"), referral = prop(row, "referral");
    let appFeeBps: number | null = 0;
    for (const fee of Array.isArray(fees) ? fees : []) {
      const bps = prop(fee, "fee");
      appFeeBps = appFeeBps !== null && typeof bps === "number" && Number.isInteger(bps) && bps >= 0 ? appFeeBps + bps : null;
    }
    if (appFeeBps !== null && appFeeBps >= 10_000) appFeeBps = null;
    return {
      createdAt, status: String(prop(row, "status") ?? ""), depositAddress: String(prop(row, "depositAddress") ?? ""),
      deposit: String(prop(row, "depositAddressAndMemo") || prop(row, "depositAddress") || ""),
      nearTxHashes: hashes.filter((hash): hash is string => typeof hash === "string"),
      intentHashes: typeof intents === "string" ? intents.split(",").map(hash => hash.trim()).filter(Boolean) : [],
      originAsset: String(prop(row, "originAsset") ?? ""), destinationAsset: String(prop(row, "destinationAsset") ?? ""),
      amountIn: typeof amountIn === "string" && UNSIGNED.test(amountIn) ? BigInt(amountIn) : null,
      appFeeBps, referral: typeof referral === "string" ? referral : "",
    };
  });
}

/** Logs of a FastNEAR transaction's successful verifier receipts, with each receipt's block. */
export function transactionLogs(transaction: unknown): ContractLog[] {
  const txHash = prop(prop(transaction, "transaction"), "hash"), receipts = prop(transaction, "receipts");
  if (typeof txHash !== "string" || !Array.isArray(receipts)) throw new Error("Invalid FastNEAR transaction");
  const logs: ContractLog[] = [];
  for (const receipt of receipts) {
    const execution = prop(receipt, "execution_outcome"), outcome = prop(execution, "outcome");
    if (prop(outcome, "executor_id") !== VERIFIER) continue;
    const status = prop(outcome, "status");
    if (prop(status, "SuccessValue") === undefined && prop(status, "SuccessReceiptId") === undefined) continue;
    const height = prop(execution, "block_height"), nanos = prop(execution, "block_timestamp"), receiptId = prop(prop(receipt, "receipt"), "receipt_id"), lines = prop(outcome, "logs");
    if (typeof height !== "number" || typeof nanos !== "number" || typeof receiptId !== "string" || !Array.isArray(lines)) throw new Error("Invalid FastNEAR receipt");
    // FastNEAR sends nanoseconds as a JSON number: exact to well under a millisecond.
    const time = Math.floor(nanos / 1e6);
    for (const text of lines) if (typeof text === "string") logs.push({ height, time, txHash, receiptId, account: VERIFIER, text });
  }
  return logs;
}

export type SourcesDeps = {
  explorerJwt: string;
  /** FastNEAR subscription key; without it, transactions are read at the free tier's pace. */
  fastnearApiKey: string | undefined;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * The Explorer API and FastNEAR's transaction API, shared by every reader in a process: the
 * Explorer's per-partner pace is enforced across them. Requests take turns in arrival order,
 * except that live (`urgent`) requests go before waiting history pages.
 */
export class IntentsSources {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** When the last Explorer request started; requests are spaced EXPLORER_PACE_MS apart. */
  private explorerAt = 0;
  private readonly waiting: { urgent: boolean; start: () => void }[] = [];
  private granting = false;

  constructor(private readonly deps: SourcesDeps) {
    this.fetcher = deps.fetcher ?? fetch;
    this.sleep = deps.sleep ?? Bun.sleep;
    this.now = deps.now ?? Date.now;
  }

  /**
   * Up to `count` swaps created before `before` (the newest when absent), newest first, retried
   * until listed or `stopped`; empty once stopped. All statuses unless `statuses` is given.
   */
  async explorer(options: { before?: number; count: number; statuses?: string; urgent?: boolean; stopped: () => boolean }): Promise<ExplorerSwap[]> {
    const url = new URL(EXPLORER_URL);
    url.searchParams.set("numberOfTransactions", String(options.count));
    if (options.statuses) url.searchParams.set("statuses", options.statuses);
    if (options.before !== undefined) url.searchParams.set("endTimestamp", new Date(options.before).toISOString());
    while (!options.stopped()) {
      await this.paced(options.urgent ?? false);
      if (options.stopped()) break;
      const response = await this.fetcher(url, { headers: { Authorization: `Bearer ${this.deps.explorerJwt}` }, signal: AbortSignal.timeout(60_000) }).catch(error => error instanceof Error ? error : new Error(String(error)));
      if (!(response instanceof Error) && response.ok) return explorerSwaps(await response.json());
      log("intents.explorer.retry", { status: response instanceof Error ? response.message : response.status }, "warn");
      if (!(response instanceof Error)) await response.body?.cancel();
      await this.sleep(RETRY_MS);
    }
    return [];
  }

  /** Resolves at this request's turn: the pace after the previous request started, urgent ones first. */
  private paced(urgent: boolean): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.waiting.push({ urgent, start: resolve });
    void this.grant();
    return promise;
  }

  private async grant(): Promise<void> {
    if (this.granting) return;
    this.granting = true;
    try {
      while (this.waiting.length) {
        const wait = this.explorerAt + EXPLORER_PACE_MS - this.now();
        if (wait > 0) await this.sleep(wait);
        // Chosen after the wait, so an urgent request arriving meanwhile goes first.
        const index = Math.max(0, this.waiting.findIndex(entry => entry.urgent));
        const [next] = this.waiting.splice(index, 1);
        this.explorerAt = this.now();
        next!.start();
      }
    } finally { this.granting = false; }
  }

  /** Verifier logs of each transaction FastNEAR returns, by hash; retried until read. */
  async transactions(hashes: readonly string[]): Promise<Map<string, ContractLog[]>> {
    const result = new Map<string, ContractLog[]>();
    const batches: string[][] = [];
    for (let i = 0; i < hashes.length; i += FASTNEAR_BATCH) batches.push(hashes.slice(i, i + FASTNEAR_BATCH));
    const step = this.deps.fastnearApiKey ? FASTNEAR_KEYED_CONCURRENCY : 1;
    for (let i = 0; i < batches.length; i += step) {
      for (const transactions of await Promise.all(batches.slice(i, i + step).map(batch => this.batch(batch)))) {
        for (const transaction of transactions) result.set(String(prop(prop(transaction, "transaction"), "hash")), transactionLogs(transaction));
      }
    }
    return result;
  }

  private async batch(hashes: readonly string[]): Promise<unknown[]> {
    const key = this.deps.fastnearApiKey;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`;
    for (;;) {
      if (!key) await this.sleep(FASTNEAR_PACE_MS);
      const response = await this.fetcher(FASTNEAR_TX_URL, { method: "POST", headers, body: JSON.stringify({ tx_hashes: hashes }), signal: AbortSignal.timeout(60_000) })
        .catch(error => error instanceof Error ? error : new Error(String(error)));
      if (response instanceof Error || !response.ok) {
        if (!(response instanceof Error)) await response.body?.cancel();
        if (response instanceof Error || response.status !== 429 || key) log("intents.fastnear.retry", { status: response instanceof Error ? response.message : response.status }, "warn");
        await this.sleep(RETRY_MS);
        continue;
      }
      const transactions = prop(await response.json(), "transactions");
      if (!Array.isArray(transactions)) throw new Error("Invalid FastNEAR response");
      return transactions;
    }
  }
}
