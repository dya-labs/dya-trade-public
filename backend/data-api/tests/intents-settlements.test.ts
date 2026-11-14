import { describe, expect, test } from "bun:test";
import type { ClickHouse } from "../src/clickhouse";
import type { ContractLog } from "../src/near/neardata";
import { EXPLORER_URL, explorerSwaps, FASTNEAR_TX_URL, IntentsSources, type ExplorerSwap } from "../src/venues/intents/explorer";
import { IntentsSettlements } from "../src/venues/intents/settlements";
import { settlementTrades, NORMAL_DECIMALS, type Resolve } from "../src/venues/intents/trades";
import { settledSwap, transfersFromLogs } from "../src/venues/intents/transfers";
import recorded from "./fixtures/intents-settlements.json";

// Recorded 2026-11-08 from the Explorer and the verifier's blocks: every verifier log of each swap's
// NEAR transactions, including the settler's payments to solvers in the same receipts.
type Case = keyof typeof recorded.swaps;
const swap = (name: Case): ExplorerSwap => explorerSwaps([recorded.swaps[name]])[0]!;
const logs = recorded.logs as Record<string, ContractLog[]>;
const transfersOf = (entry: ExplorerSwap) => transfersFromLogs(entry.nearTxHashes.flatMap(hash => logs[hash] ?? []), detail => { throw new Error(detail); });
const SETTLER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";

describe("swaps settled by transfers", () => {
  test("the deposit account's net exchange with the settler, paid out in the settler's last destination transfer", () => {
    const exact = swap("exactInput");
    expect(settledSwap(exact, transfersOf(exact))).toEqual({
      swap: {
        time: 1794133811323, height: 223603777, txHash: "BLmB7Poe7isbRbpCRMo9CJG1FdUFg3BZ4EKfgDUJdEZV",
        account: "58c470db4ac0bfbdb49dd7ce8dc2d51bbc62ce0cc9245d9b641eaa5945af1b1e", settler: SETTLER,
        originAsset: "nep141:eth.omft.near", amountIn: 921691190993553n, destinationAsset: "nep141:tron.omft.near", amountOut: 6352068n,
      },
    });
    // Exact output: the unused input comes back with the withdrawal, after the payout.
    const refunded = swap("exactOutputRefund");
    expect(settledSwap(refunded, transfersOf(refunded))).toMatchObject({ swap: { txHash: "BqxN6qVTXkZXMNRNe3kRVicriJAJSeEqov2LPV7KakVf", amountIn: 279587162n, amountOut: 3500300000n } });
  });

  test("a deposit forwarded by the user's own account settles with the Explorer deposit address", () => {
    const forwarded = swap("forwardedDeposit");
    expect(settledSwap(forwarded, transfersOf(forwarded))).toMatchObject({ swap: { account: forwarded.depositAddress, settler: SETTLER, amountIn: 498962208n, amountOut: 498924462n } });
    expect(settledSwap({ ...forwarded, depositAddress: "elsewhere" }, transfersOf(forwarded))).toEqual({ reason: "ambiguous" });
  });

  test("the input is the Explorer's swapped amount, never more than the account gave", () => {
    const withheld = swap("withheldDepositFee");
    // The account gave 141948; 1Click swapped 140760 of it.
    expect(settledSwap(withheld, transfersOf(withheld))).toMatchObject({ swap: { amountIn: 140760n, amountOut: 19743956n } });
    expect(settledSwap({ ...withheld, amountIn: 141949n }, transfersOf(withheld))).toEqual({ reason: "amount-mismatch" });
    expect(settledSwap({ ...withheld, amountIn: null }, transfersOf(withheld))).toMatchObject({ swap: { amountIn: 141948n } });
    expect(settledSwap(withheld, [])).toEqual({ reason: "no-transfers" });
  });

  test("trades take the off-chain app fee off the input; same-asset and unknown assets chart nothing", () => {
    const resolve: Resolve = id => ({ "nep141:eth.omft.near": { group: "ethereum", decimals: 18 }, "nep141:tron.omft.near": { group: "tron", decimals: 6 }, "nep141:usdt": { group: "usd", decimals: 6 }, "nep141:usdc": { group: "usd", decimals: 6 } })[id];
    const exchange = { originAsset: "nep141:eth.omft.near", amountIn: 1_000_000_000_000_000_000n, destinationAsset: "nep141:tron.omft.near", amountOut: 9_000_000n, appFeeBps: 80 };
    const scale = 10n ** BigInt(NORMAL_DECIMALS);
    expect(settlementTrades(exchange, resolve)).toEqual({ status: "settlement", trades: [{ index: 0, kind: "swap", sold: { group: "ethereum", amount: 992n * scale / 1000n }, bought: { group: "tron", amount: 9n * scale } }] });
    expect(settlementTrades({ ...exchange, originAsset: "nep141:usdt", destinationAsset: "nep141:usdc" }, resolve)).toEqual({ status: "bridge", trades: [] });
    expect(settlementTrades({ ...exchange, destinationAsset: "nep141:unlisted" }, resolve)).toEqual({ status: "unknown-asset", trades: [] });
  });
});

/** A recorded transaction as FastNEAR returns it. */
function transaction(hash: string) {
  const receipts = [...Map.groupBy(logs[hash] ?? [], log => log.receiptId)].map(([receiptId, entries]) => ({
    receipt: { receipt_id: receiptId },
    execution_outcome: { block_height: entries[0]!.height, block_timestamp: entries[0]!.time * 1e6, outcome: { executor_id: "intents.near", status: { SuccessValue: "" }, logs: entries.map(entry => entry.text) } },
  }));
  return { transaction: { hash }, receipts };
}

describe("live settlement polling", () => {
  test("stores a swap once its payout is listed, reads each transaction list once, and publishes each swap once", async () => {
    const MINUTE = 60_000;
    let now = Date.parse("2026-11-08T10:40:00Z");
    const done = recorded.swaps.exactInput, paying = recorded.swaps.withheldDepositFee;
    // In flight with only its deposit and its transfer to the settler listed so far.
    const inFlight = { ...paying, status: "PROCESSING", nearTxHashes: paying.nearTxHashes.slice(0, 2) };
    const refunded = { ...recorded.swaps.exactOutputRefund, status: "REFUNDED" };
    let page: unknown[] = [done, inFlight, refunded];
    const fastnear: string[][] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(EXPLORER_URL)) return Response.json(page);
      if (url === FASTNEAR_TX_URL) {
        const hashes: string[] = JSON.parse(String(init?.body)).tx_hashes;
        fastnear.push(hashes);
        return Response.json({ transactions: hashes.map(transaction) });
      }
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch;
    const inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
    const clickhouse = {
      query: async (sql: string) => { if (sql.includes("FROM intents_diffs")) return []; throw new Error(`Unexpected query ${sql}`); },
      insert: async (table: string, rows: Record<string, unknown>[]) => { inserts.push({ table, rows }); },
    } as unknown as ClickHouse;
    const published: number[] = [];
    const settlements = new IntentsSettlements({
      clickhouse, sources: new IntentsSources({ explorerJwt: "jwt", fastnearApiKey: "key", fetcher, sleep: async () => {}, now: () => now }),
      target: 0, now: () => now, stored: stored => published.push(...stored.map(entry => entry.time)),
    });
    const watermarks = () => inserts.filter(entry => entry.table === "intents_state").flatMap(entry => entry.rows).map(row => Number(row.time));
    const settled = () => inserts.filter(entry => entry.table === "intents_settlements").flatMap(entry => entry.rows).map(row => row.deposit_address);
    const poll = async (next: unknown[]) => { now += MINUTE; page = next; fastnear.length = 0; await settlements.poll(now - 60 * MINUTE); };

    await settlements.poll(now - 60 * MINUTE);
    expect(settled()).toEqual([done.depositAddress]);
    expect(published).toEqual([1794133811323]);
    expect(watermarks()).toEqual([now - 5 * MINUTE]);

    // Nothing new listed: no transaction is read again.
    await poll([done, inFlight, refunded]);
    expect(fastnear).toEqual([]);

    // Its payout is listed while still processing: stored and published at once.
    await poll([done, { ...inFlight, nearTxHashes: paying.nearTxHashes.slice(0, 3) }, refunded]);
    expect(settled()).toEqual([done.depositAddress, paying.depositAddress]);
    expect(published).toEqual([1794133811323, 1794133882628]);

    // Successful: read and stored once more, not published again; then never read again.
    await poll([done, { ...paying, status: "SUCCESS" }, refunded]);
    expect(fastnear.flat().sort()).toEqual([...paying.nearTxHashes].sort());
    expect(settled()).toEqual([done.depositAddress, paying.depositAddress, paying.depositAddress]);
    expect(published).toHaveLength(2);
    await poll([done, { ...paying, status: "SUCCESS" }, refunded]);
    expect(fastnear).toEqual([]);
    expect(watermarks().at(-1)).toBe(now - 5 * MINUTE);
  });
});

test("Explorer requests stay paced across readers, live polls before waiting history pages", async () => {
  let now = 0;
  const pages: string[] = [], sleeps: number[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    pages.push(new URL(String(input)).searchParams.get("endTimestamp") ?? "newest");
    return Response.json([]);
  }) as typeof fetch;
  const sources = new IntentsSources({ explorerJwt: "jwt", fastnearApiKey: undefined, fetcher, now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; } });
  const stopped = () => false;
  const history = [sources.explorer({ before: 1_000, count: 1, stopped }), sources.explorer({ before: 2_000, count: 1, stopped })];
  const live = sources.explorer({ count: 1, urgent: true, stopped });
  await Promise.all([...history, live]);
  expect(pages).toEqual(["newest", new Date(1_000).toISOString(), new Date(2_000).toISOString()]);
  expect(sleeps).toEqual([5_500, 5_500, 5_500]);
});
