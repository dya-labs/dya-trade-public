import { expect, test } from "bun:test";
import type { ClickHouse } from "../src/clickhouse";
import { IntentsBackfill, recoveredSwap } from "../src/venues/intents/backfill";
import { EXPLORER_URL, FASTNEAR_TX_URL, IntentsSources, transactionLogs } from "../src/venues/intents/explorer";
import { diffsFromLogs } from "../src/venues/intents/diffs";
import recorded from "./fixtures/intents-receipts.json";

type Event = { block_height: number; block_timestamp_nanosec: string; transaction_id: string; receipt_id: string; log_text: string };
const SWITCH = Date.parse("2026-10-15T12:00:00Z");

/** A recorded receipt as FastNEAR returns its transaction (plus a failed receipt that must be ignored). */
function transaction(hash: string, events: readonly Event[]) {
  const receipts: unknown[] = [...Map.groupBy(events, event => event.receipt_id)].map(([receiptId, logs]) => ({
    receipt: { receipt_id: receiptId },
    execution_outcome: { block_height: logs[0]!.block_height, block_timestamp: Number(logs[0]!.block_timestamp_nanosec), outcome: { executor_id: "intents.near", status: { SuccessValue: "" }, logs: logs.map(log => log.log_text) } },
  }));
  if (events.length) receipts.push({ receipt: { receipt_id: "failed" }, execution_outcome: { block_height: 1, block_timestamp: 1e18, outcome: { executor_id: "intents.near", status: { Failure: {} }, logs: [events[0]!.log_text.replace(/"intent_hash":"[^"]+"/, '"intent_hash":"reverted"')] } } });
  return { transaction: { hash }, receipts };
}

const intentHashes = (events: readonly Event[]) => events.flatMap(event => JSON.parse(event.log_text.slice(11)).data).filter((item: { referral?: string }) => item.referral).map((item: { intent_hash: string }) => item.intent_hash);

test("FastNEAR transactions yield the logs of successful verifier receipts only", () => {
  const events = recorded.receipts.simple;
  const logs = transactionLogs(transaction("T", events));
  expect(logs).toHaveLength(events.length);
  expect(logs.some(log => log.text.includes('"reverted"'))).toBe(false);
  expect(logs[0]).toMatchObject({ txHash: "T", height: events[0]!.block_height, account: "intents.near" });
});

test("walks the Explorer back to the target, stores every intent of each swap's transaction, records unrecoverable swaps", async () => {
  const simple = recorded.receipts.simple, stable = recorded.receipts.routeViaStablecoin;
  const pages = [[
    { createdAt: "2026-10-15T11:59:00.000Z", depositAddress: "d1", intentHashes: [...intentHashes(simple), "absent-non-swap-intent"].join(","), nearTxHashes: ["deposit-1", "exec-1"], originAsset: "nep141:eth.omft.near", destinationAsset: "nep141:sol.omft.near" },
    // Its intents sit in the first transaction, not the usual second one.
    { createdAt: "2026-10-15T11:58:00.000Z", depositAddress: "d2", intentHashes: intentHashes(stable).join(","), nearTxHashes: ["exec-2", "other-2"], originAsset: "nep141:eth.omft.near", destinationAsset: "nep141:tron.omft.near" },
    { createdAt: "2026-10-15T11:57:00.000Z", depositAddress: "d3", intentHashes: "missing", nearTxHashes: ["deposit-3", "exec-3"], originAsset: "c", destinationAsset: "d" },
  ]];
  const transactions: Record<string, unknown> = { "exec-1": transaction("exec-1", simple), "exec-2": transaction("exec-2", stable), "deposit-1": transaction("deposit-1", []), "other-2": transaction("other-2", []), "deposit-3": transaction("deposit-3", []), "exec-3": transaction("exec-3", []) };
  const explorerCalls: string[] = [], fastnear: string[][] = [], fastnearAuth = new Set<string | null>();
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(EXPLORER_URL)) { explorerCalls.push(new URL(url).searchParams.get("endTimestamp")!); return Response.json(pages.shift() ?? []); }
    if (url === FASTNEAR_TX_URL) {
      const hashes: string[] = JSON.parse(String(init?.body)).tx_hashes;
      fastnear.push(hashes);
      fastnearAuth.add(new Headers(init?.headers).get("authorization"));
      return Response.json({ transactions: hashes.flatMap(hash => transactions[hash] ? [transactions[hash]] : []) });
    }
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;
  const inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
  const clickhouse = {
    query: async (sql: string) => sql.includes("'backfill'") ? [] : [{ key: "cursor", height: 9, time: SWITCH + 60_000 }, { key: "switch", height: 5, time: SWITCH }],
    insert: async (table: string, rows: Record<string, unknown>[]) => { inserts.push({ table, rows }); },
  } as unknown as ClickHouse;
  const target = SWITCH - 3_600_000;
  const done = await new IntentsBackfill({ clickhouse, sources: new IntentsSources({ explorerJwt: "jwt", fastnearApiKey: "key", fetcher, sleep: async () => {} }), target }).run();

  expect(done).toBe(true);
  // An invalid or missing key is silently served as free tier, so the key must reach every request.
  expect([...fastnearAuth]).toEqual(["Bearer key"]);
  expect(explorerCalls).toEqual([new Date(SWITCH).toISOString()]);
  // Second transactions first; the other hashes only for the swaps not found there.
  expect(fastnear[0]!.sort()).toEqual(["exec-1", "exec-3", "other-2"]);
  expect(fastnear[1]!.sort()).toEqual(["deposit-3", "exec-2"]);
  const stored = inserts.filter(entry => entry.table === "intents_diffs").flatMap(entry => entry.rows);
  expect(new Set(stored.map(row => row.tx_hash))).toEqual(new Set(["exec-1", "exec-2"]));
  expect(stored.some(row => row.intent_hash === "reverted")).toBe(false);
  expect(inserts.filter(entry => entry.table === "intents_gaps").flatMap(entry => entry.rows).map(row => row.deposit_address)).toEqual(["d3"]);
  // A short page is the Explorer's end: the position moves to the target.
  expect(inserts.filter(entry => entry.table === "intents_state").flatMap(entry => entry.rows)).toEqual([{ key: "backfill", height: 0, time: String(target) }]);
});

test("pages continue from each full page's oldest time; each position is stored after its page, and stop discards the page loading ahead", async () => {
  const row = (time: number, id: string) => ({ createdAt: new Date(time).toISOString(), depositAddress: id, intentHashes: "", nearTxHashes: [], originAsset: "a", destinationAsset: "b" });
  const full = (newest: number, tag: string) => Array.from({ length: 1000 }, (_, i) => row(newest - i * 1000, `${tag}${i}`));
  const first = full(SWITCH - 1000, "p"), second = full(SWITCH - 1_000_000, "q");
  const oldestFirst = SWITCH - 1_000_000, oldestSecond = SWITCH - 1_999_000;
  const run = async (stopAfterFirst: boolean) => {
    const pages = [first, second, [row(oldestSecond - 1000, "r0")]];
    const explorerCalls: string[] = [], log: string[] = [];
    let backfill: IntentsBackfill;
    const fetcher = (async (input: string | URL | Request) => {
      explorerCalls.push(new URL(String(input)).searchParams.get("endTimestamp")!);
      return Response.json(pages.shift() ?? []);
    }) as typeof fetch;
    const clickhouse = {
      query: async (sql: string) => sql.includes("'backfill'") ? [] : [{ key: "switch", height: 5, time: SWITCH }],
      insert: async (table: string, rows: Record<string, unknown>[]) => {
        if (table === "intents_gaps") log.push(`gaps:${rows.length}`);
        if (table === "intents_state") { log.push(`position:${rows[0]!.time}`); if (stopAfterFirst) backfill.stop(); }
      },
    } as unknown as ClickHouse;
    backfill = new IntentsBackfill({ clickhouse, sources: new IntentsSources({ explorerJwt: "jwt", fastnearApiKey: "key", fetcher, sleep: async () => {} }), target: SWITCH - 86_400_000 });
    const done = await backfill.run();
    return { done, explorerCalls, log };
  };

  const all = await run(false);
  expect(all.done).toBe(true);
  expect(all.explorerCalls).toEqual([SWITCH, oldestFirst + 1, oldestSecond + 1].map(time => new Date(time).toISOString()));
  expect(all.log).toEqual(["gaps:1000", `position:${oldestFirst + 1}`, "gaps:1000", `position:${oldestSecond + 1}`, "gaps:1", `position:${SWITCH - 86_400_000}`]);

  const stopped = await run(true);
  expect(stopped.done).toBe(false);
  // The second page was already loading, but nothing of it is stored and the position stays after page one.
  expect(stopped.log).toEqual(["gaps:1000", `position:${oldestFirst + 1}`]);
});

test("recovery uses exact executed swap diffs, not every Explorer hash or unrelated log text", () => {
  const originAsset = "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g";
  const destinationAsset = "nep141:base-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.omft.near";
  // Stored production gap, 2026-04-19: the second listed intent contains the whole swap;
  // the first has no stored token_diff. Amount strings preserve the UInt256-sized input.
  const swap = { originAsset, destinationAsset, intentHashes: ["CQP9jmKrm4GmvyZHuEi4tuo3Jh1K46S9tS1NjyKNGZwu", "EUGVCygTZzFoWZF4SDnWdVrzTqtUut31jbkk2EseRXeR"] };
  const event = {
    intent_hash: swap.intentHashes[1], account_id: "4ba16379c17c8bcce4db980fda900aaf7cd8915ebc8c40ac80f8110dda80c18e",
    referral: "1click-lifi", diff: { [originAsset]: "-30476796879372041544", [destinationAsset]: "40727" },
  };
  const log = { height: 1, time: SWITCH, txHash: "7RmbN1ir6vkD5tEqec33Z1htK87qDvEFyft8XBjt738X", receiptId: "sample", account: "intents.near",
    text: `EVENT_JSON:${JSON.stringify({ standard: "dip4", version: "0.4.3", event: "token_diff", data: [event] })}` };
  const diffs = diffsFromLogs([log], detail => { throw new Error(detail); });
  expect(recoveredSwap(swap, diffs)).toBe(true);
  expect(recoveredSwap({ ...swap, intentHashes: [swap.intentHashes[1]!.slice(1)] }, diffs)).toBe(false);
  expect(recoveredSwap({ ...swap, originAsset: destinationAsset, destinationAsset: originAsset }, diffs)).toBe(false);
  expect(recoveredSwap(swap, diffsFromLogs([{ ...log, text: log.text.replace('"event":"token_diff"', '"event":"intents_executed"') }], () => {}))).toBe(false);
  const invalid: string[] = [];
  expect(recoveredSwap(swap, diffsFromLogs([{ ...log, text: log.text.replace("-30476796879372041544", "invalid") }], detail => invalid.push(detail)))).toBe(false);
  expect(invalid).toHaveLength(1);
});

test("recovery nets same-account legs, resolves Omni BTC and retains gas-only or wrong-chain gaps", () => {
  // Production BTC -> SOL gap has a main leg and a SOL -> NEAR gas leg under one hash.
  const hash = "4CP5zVJCGkgrCr5Brrv7oJZ2HehtzLvxQdScNgfxbVsy";
  const originAsset = "nep141:nbtc.bridge.near", destinationAsset = "nep141:sol.omft.near";
  const swap = { intentHashes: [hash, "BQBYYPdX8sDsqSq8UN1xbR4XqvZpfztQJdmD9cWV4oCU"], originAsset, destinationAsset };
  const account = "8f2fb0653bff862461d72d7c5ecca77852c742c0f8b4f7c33b89daa5100c0317";
  const diffs = diffsFromLogs([{ height: 1, time: SWITCH, txHash: "sample", receiptId: "sample", account: "intents.near",
    text: `EVENT_JSON:${JSON.stringify({ standard: "dip4", version: "0.4.3", event: "token_diff", data: [
      { intent_hash: hash, account_id: account, diff: { [originAsset]: "-112967", [destinationAsset]: "806197257" } },
      { intent_hash: hash, account_id: account, diff: { [destinationAsset]: "-85234", "nep141:wrap.near": "1941747572922035507304" } },
    ] })}` }], detail => { throw new Error(detail); });
  expect(recoveredSwap(swap, diffs)).toBe(true);
  expect(recoveredSwap(swap, diffs.slice(1))).toBe(false);
  expect(recoveredSwap({ ...swap, originAsset: "1cs_v1:btc:native:coin" }, diffs)).toBe(true);
  expect(recoveredSwap({ ...swap, originAsset: "nep141:btc.omft.near" }, diffs)).toBe(false);
  expect(recoveredSwap({ ...swap, originAsset: "1cs_v1:unknown:native:coin" }, diffs)).toBe(false);
  expect(recoveredSwap({ ...swap, originAsset: destinationAsset, destinationAsset: "1cs_v1:btc:native:coin" },
    diffs.map(diff => ({ ...diff, diff: new Map([...diff.diff].map(([token, amount]) => [token, -amount])) })))).toBe(true);
  const main = diffs[0]!;
  const routed = [
    { ...main, diff: new Map([[originAsset, -112967n], ["intermediate", 10n]]) },
    { ...main, item: 2, diff: new Map([["intermediate", -10n], [destinationAsset, 806197257n]]) },
  ];
  expect(recoveredSwap(swap, routed)).toBe(true);
  expect(recoveredSwap(swap, [routed[0]!, { ...routed[1]!, account: "another-account" }])).toBe(false);
  expect(recoveredSwap(swap, [...diffs, { ...main, item: 3, diff: new Map([[destinationAsset, -806197257n]]) }])).toBe(false);
});
