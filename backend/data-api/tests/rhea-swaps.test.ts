import { describe, expect, test } from "bun:test";
import { blockLogs as nearBlockLogs, type ContractLog } from "../src/near/neardata";
import { rheaSource } from "../src/venues/rhea/indexer";
import { swapsFromLogs } from "../src/venues/rhea/swaps";

const blockLogs = (value: unknown) => nearBlockLogs(value, rheaSource.accounts);

// Receipt outcomes recorded from mainnet neardata.xyz blocks 219943492-219943565 (2026-10-14),
// trimmed to the fields the parser reads.
const classic = { tx_hash: "8tEUodDbuUSLNREgztLTmQFdU8NJRR73bDerw7MK49iu", execution_outcome: { id: "55ZQeTnUJqGQE3HdMuCd3qx3CisyfiBaeDVh4voM8FnN", outcome: { executor_id: "v2.ref-finance.near", status: { SuccessValue: "IjEwNjM0ODQ0Ig==" }, logs: ["Swapped 25391351537387689956343808 wrap.near for 10634844 zec.omft.near", "Exchange v2.ref-finance.near got 3728754313195469 shares, No referral fee"] } } };
const split = { tx_hash: "21RjXKTJs7ry7w8aDyvSwKnp2ML2A77JkwHGqRSxiP9U", execution_outcome: { id: "CimnqXVtkdgKf9WfgdpP7SyubD3qzJKkhCoGrG4gD2vk", outcome: { executor_id: "v2.ref-finance.near", status: { SuccessValue: "IjAi" }, logs: ["Swapped 249775000000000000000 token.rhealab.near for 3877934908212928374220007 wrap.near", "Exchange v2.ref-finance.near got 237052567375789908111798 shares, No referral fee", "Swapped 249775000000000000000 token.rhealab.near for 3877698809591872867523756 wrap.near", "Exchange v2.ref-finance.near got 237045342519448245024271 shares, No referral fee"] } } };
const dcl = { tx_hash: "AzXEgUU8e1B2oNpi7JMpHmT1sW6tvw2ZPdzs2ZcFvexE", execution_outcome: { id: "E8S1edxaB6NdD94JkL17bT67JN6UTX1sajqM3A6ftHCT", outcome: { executor_id: "dclv2.ref-labs.near", status: { SuccessValue: "IjAi" }, logs: ["EVENT_JSON:{\"data\":[{\"amount_in\":\"8163603\",\"amount_out\":\"69628612465\",\"pool_id\":\"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1|qtc.omft.near|2000\",\"protocol_fee\":\"3265\",\"referral_fee\":\"0\",\"referral_id\":null,\"swapper\":\"intents.near\",\"token_in\":\"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1\",\"token_out\":\"qtc.omft.near\",\"total_fee\":\"16328\"}],\"event\":\"swap\",\"standard\":\"dcl.ref\",\"version\":\"1.0.0\"}"] } } };
// A two-hop route whose receipt failed: its logs are recorded, its swaps reverted.
const failed = { tx_hash: "BAfkKV2rB3gaxSm3EUwGQv9zdq1nA7yWxJnDwYVw3KzJ", execution_outcome: { id: "GmcULL1DGHq3Kj9N6BoieZYRsMhHq1rHnq9j1EFbcyNd", outcome: { executor_id: "v2.ref-finance.near", status: { Failure: { ActionError: { index: 0, kind: "FunctionCallError" } } }, logs: ["Swapped 1000000000000000000000000 wrap.near for 419418 zec.omft.near", "Exchange v2.ref-finance.near got 6696993527416049 shares, No referral fee", "Swapped 419418 zec.omft.near for 467133214724455828041362 zolanear-1726.meme-cooking.near", "Exchange v2.ref-finance.near got 14675750421737139280 shares, No referral fee"] } } };
const unrelated = { tx_hash: "x", execution_outcome: { id: "y", outcome: { executor_id: "wrap.near", status: { SuccessValue: "" }, logs: ["Swapped 1 a.near for 2 b.near"] } } };

const block = (outcomes: unknown[][]) => ({ block: { header: { height: 219943503, prev_height: 219943502, timestamp_nanosec: "1791987865445072350" } }, shards: outcomes.map(receipt_execution_outcomes => ({ receipt_execution_outcomes })) });
const log = (text: string, account = "v2.ref-finance.near", receiptId = "R"): ContractLog => ({ height: 1, time: 2, txHash: "T", receiptId, account, text });

describe("neardata block logs", () => {
  test("keeps successful Rhea receipts only, with block time in milliseconds", () => {
    const logs = blockLogs(block([[classic, failed], [unrelated, dcl]]));
    expect(new Set(logs.map(entry => entry.receiptId))).toEqual(new Set([classic.execution_outcome.id, dcl.execution_outcome.id]));
    expect(logs[0]).toMatchObject({ height: 219943503, time: 1791987865445, txHash: classic.tx_hash, account: "v2.ref-finance.near" });
  });
});

describe("Rhea swap logs", () => {
  test("classic swap: tokens and exact raw amounts", () => {
    const [swap] = swapsFromLogs(blockLogs(block([[classic]])), () => { throw new Error("invalid"); });
    expect(swap).toMatchObject({ contract: "classic", poolId: "", tokenIn: "wrap.near", amountIn: 25391351537387689956343808n, tokenOut: "zec.omft.near", amountOut: 10634844n, logIndex: 0 });
  });

  test("stable and rated pools log fees after the amounts", () => {
    // Recorded from Intear log_text, receipt DLoPYRHqvF3J7CrUB3TJGLTkRDrAs4VZDZjuicoPSLza (2026-10-14).
    const [swap] = swapsFromLogs([log("Swapped 600000000 usdt.tether-token.near for 599313388 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1, total fee 59937, admin fee 11987")], () => { throw new Error("invalid"); });
    expect(swap).toMatchObject({ tokenIn: "usdt.tether-token.near", amountIn: 600000000n, tokenOut: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", amountOut: 599313388n });
  });

  test("several swaps in one receipt get distinct, replay-stable indexes", () => {
    const logs = blockLogs(block([[split]]));
    const first = swapsFromLogs(logs, () => {}), again = swapsFromLogs(logs, () => {});
    expect(first.map(swap => [swap.logIndex, swap.amountOut])).toEqual([[0, 3877934908212928374220007n], [100, 3877698809591872867523756n]]);
    expect(again).toEqual(first);
  });

  test("DCL swap event: pool id and amounts", () => {
    const [swap] = swapsFromLogs(blockLogs(block([[dcl]])), () => { throw new Error("invalid"); });
    expect(swap).toMatchObject({ contract: "dcl", poolId: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1|qtc.omft.near|2000", tokenIn: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", amountIn: 8163603n, tokenOut: "qtc.omft.near", amountOut: 69628612465n });
  });

  test("zero-amount DCL items move nothing and are dropped", () => {
    const text = 'EVENT_JSON:{"data":[{"amount_in":"0","amount_out":"0","pool_id":"a.near|wrap.near|100","token_in":"wrap.near","token_out":"a.near"},{"amount_in":"5","amount_out":"7","pool_id":"a.near|wrap.near|100","token_in":"wrap.near","token_out":"a.near"}],"event":"swap","standard":"dcl.ref","version":"1.0.0"}';
    expect(swapsFromLogs([log(text, "dclv2.ref-labs.near")], () => {}).map(swap => [swap.logIndex, swap.amountOut])).toEqual([[1, 7n]]);
  });

  test("malformed swap logs are reported and skipped; other Rhea logs are ignored", () => {
    const errors: string[] = [];
    const swaps = swapsFromLogs([
      log("Swapped 12 wrap.near for -3 a.near", undefined, "BAD"),
      log("Exchange v2.ref-finance.near got 1 shares, No referral fee"),
      log('EVENT_JSON:{"data":[{"amount":"5"}],"event":"add_liquidity","standard":"dcl.ref"}', "dclv2.ref-labs.near"),
      log("Swapped 1 wrap.near for 2 a.near"),
    ], error => errors.push(error));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("BAD:");
    expect(swaps.map(swap => swap.tokenOut)).toEqual(["a.near"]);
  });
});
