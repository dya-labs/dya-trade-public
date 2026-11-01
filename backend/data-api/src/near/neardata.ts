import { prop } from "../json";
import { USER_AGENT } from "../venues/http";

export const NEARDATA_URL = "https://mainnet.neardata.xyz";

/** neardata.xyz access; `apiKey` is a FastNEAR subscription key (the free tier can't follow the chain). */
export type Neardata = { url: string; apiKey: string | undefined; fetcher?: typeof fetch };

/** One log of a successful receipt executed by an indexed contract. */
export type ContractLog = { height: number; time: number; txHash: string; receiptId: string; account: string; text: string };
/** A finalized block: `prev` is the height of the block before it (heights in between produced no block). */
export type BlockHeader = { height: number; prev: number; time: number };

export class NeardataError extends Error {
  constructor(readonly status: number | string) {
    super(`neardata answered ${status}`);
  }
}

export function nanosToMs(value: unknown): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error("Invalid block timestamp");
  return Number(BigInt(value) / 1_000_000n);
}

export function blockHeader(block: unknown): BlockHeader {
  const header = prop(prop(block, "block"), "header");
  const height = prop(header, "height"), prev = prop(header, "prev_height");
  if (typeof height !== "number" || typeof prev !== "number") throw new Error("Invalid neardata block header");
  return { height, prev, time: nanosToMs(prop(header, "timestamp_nanosec")) };
}

/**
 * Logs of the given contracts' successful receipts in a neardata.xyz block (`/v0/block/:height`).
 * A failed receipt still records its logs, but its effects were reverted.
 */
export function blockLogs(block: unknown, accounts: ReadonlySet<string>): ContractLog[] {
  const { height, time } = blockHeader(block);
  const shards = prop(block, "shards");
  if (!Array.isArray(shards)) throw new Error("Invalid neardata block shards");
  const logs: ContractLog[] = [];
  for (const shard of shards) {
    const outcomes = prop(shard, "receipt_execution_outcomes");
    if (!Array.isArray(outcomes)) continue;
    for (const entry of outcomes) {
      const execution = prop(entry, "execution_outcome"), outcome = prop(execution, "outcome");
      const executor = prop(outcome, "executor_id");
      if (typeof executor !== "string" || !accounts.has(executor)) continue;
      const status = prop(outcome, "status");
      if (prop(status, "SuccessValue") === undefined && prop(status, "SuccessReceiptId") === undefined) continue;
      const receiptId = prop(execution, "id"), txHash = prop(entry, "tx_hash"), lines = prop(outcome, "logs");
      if (typeof receiptId !== "string" || typeof txHash !== "string" || !Array.isArray(lines)) throw new Error("Invalid neardata receipt outcome");
      for (const text of lines) if (typeof text === "string") logs.push({ height, time, txHash, receiptId, account: executor, text });
    }
  }
  return logs;
}

/**
 * GETs a neardata path: a block JSON, or null for a height that produced no block. A height
 * just past the final block is held open by the server until it's final. The key goes in the
 * Authorization header, never the URL, so it can't leak into logs; older blocks redirect to an
 * archive host, and a redirect drops that header, so redirects within neardata are followed here.
 */
export async function neardataGet(neardata: Neardata, path: string): Promise<unknown> {
  const fetcher = neardata.fetcher ?? fetch;
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (neardata.apiKey) headers.Authorization = `Bearer ${neardata.apiKey}`;
  const domain = new URL(neardata.url).hostname.split(".").slice(-2).join(".");
  let url = `${neardata.url}${path}`;
  for (let hops = 0; hops < 3; hops++) {
    const response = await fetcher(url, { headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const next = new URL(response.headers.get("location") ?? "", url);
      if (next.protocol !== "https:" || (next.hostname !== domain && !next.hostname.endsWith(`.${domain}`))) throw new NeardataError(`redirect outside ${domain}`);
      url = next.toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new NeardataError(response.status);
    }
    return await response.json();
  }
  throw new NeardataError("too many redirects");
}
