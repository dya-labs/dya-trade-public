import { describe, expect, test } from "bun:test";
import type { ContractLog } from "../src/near/neardata";
import type { RegistrySeed } from "../src/registry-types";
import { buildCatalog, USD } from "../src/venues/intents/catalog";
import { diffsFromLogs, type IntentDiff } from "../src/venues/intents/diffs";
import { receiptTrades } from "../src/venues/intents/trades";
import recorded from "./fixtures/intents-receipts.json";
import gasRoutes from "./fixtures/intents-gas-routes.json";

type Event = { block_height: number; block_timestamp_nanosec: string; transaction_id: string; receipt_id: string; account_id: string; log_text: string };
const logs = (events: readonly Event[]): ContractLog[] => events.map(event => ({
  height: event.block_height, time: Number(BigInt(event.block_timestamp_nanosec) / 1_000_000n), txHash: event.transaction_id,
  receiptId: event.receipt_id, account: event.account_id, text: event.log_text,
}));
const receipts: Record<string, Event[]> = recorded.receipts;
const parse = (name: string) => diffsFromLogs(logs(receipts[name]!), detail => { throw new Error(detail); });

// Reviewed stablecoins are one USD asset; wNEAR maps onto the registry's NEAR asset by alias.
const STABLE = new Set(["usd-coin", "tether", "usdt0"]);
const seed: RegistrySeed = {
  generatedAt: "", catalogUrl: "", exchangeInfoUrl: "",
  stablecoins: recorded.tokens.filter(token => STABLE.has(token.coingeckoId)).map(token => token.assetId),
  assets: [{ assetId: "nep141:wrap.near", symbol: "wNEAR", chain: "near", contract: "wrap.near", coinGeckoId: "near", aliases: ["wrapped-near"], sources: [], unavailableReason: null }],
};
const { resolve } = buildCatalog(recorded.tokens, seed);
const legs = (diffs: readonly IntentDiff[]) => receiptTrades(diffs, resolve);
const shape = (name: string) => {
  const result = legs(parse(name));
  return { status: result.status, trades: result.trades.map(trade => `${trade.sold.group}→${trade.bought.group}`) };
};

describe("token_diff parsing", () => {
  test("reads every intent of a receipt and ignores the verifier's other events", () => {
    const events = receipts.simple!;
    expect(events.some(event => event.log_text.includes('"ft_withdraw"'))).toBe(true);
    const diffs = parse("simple");
    expect(diffs.map(diff => [diff.logIndex, diff.item])).toEqual([[0, 0], [1, 0]]);
    const [solver, user] = diffs;
    expect(solver!.referral).toBe("");
    expect(user!.referral).toMatch(/^1click-/);
    // Each intent's own diff balances against the other's plus fees.
    for (const token of solver!.diff.keys()) expect(solver!.diff.get(token)! + user!.diff.get(token)! + (solver!.fees.get(token) ?? 0n) + (user!.fees.get(token) ?? 0n)).toBe(0n);
  });

  test("April 2025 events (dip4 0.2.1) parse the same way; the user's intent carries a referral", () => {
    const diffs = parse("version021");
    expect(new Set(diffs.map(diff => diff.version))).toEqual(new Set(["0.2.1"]));
    expect(diffs.filter(diff => diff.referral).map(diff => diff.account)).toEqual(["9205599d40c0a91cfc4805556bd9247534fc1bf3771f150e988215286eaea116"]);
  });

  test("a malformed token_diff is reported, never guessed", () => {
    const bad: ContractLog = { height: 1, time: 1, txHash: "t", receiptId: "r", account: "intents.near", text: 'EVENT_JSON:{"standard":"dip4","version":"0.4.3","event":"token_diff","data":[{"intent_hash":"h","account_id":"a","diff":{"nep141:wrap.near":"1.5"}}]}' };
    const invalid: string[] = [];
    expect(diffsFromLogs([bad], detail => invalid.push(detail))).toEqual([]);
    expect(invalid).toHaveLength(1);
  });
});

describe("route steps (H2) with user-swap fallback (H1)", () => {
  test("a direct fill is one step between the user and the solver", () => {
    // User ETH → SOL, filled by one solver.
    expect(shape("simple")).toEqual({ status: "route", trades: ["ethereum→solana"] });
  });

  test("a route through a stablecoin charts both steps, each asset once", () => {
    // User ETH → TRX; solver 1 buys ETH with USDT, solver 2 sells TRX for USDT.
    expect(shape("routeViaStablecoin")).toEqual({ status: "route", trades: [`ethereum→${USD}`, `${USD}→tron`] });
  });

  test("a solver routing through itself nets to one step; its USDT legs are no trade", () => {
    expect(shape("solverNettingThroughItself")).toEqual({ status: "route", trades: ["official-trump→ethereum"] });
  });

  test("a version 0.2.1 route nets the solver's USDC/USDT legs like today's", () => {
    // User BTC → wNEAR; solver-priv-liq routes BTC → USDC → USDT → wNEAR within itself.
    expect(shape("version021")).toEqual({ status: "route", trades: ["bitcoin→near"] });
  });

  test("a version 0.2.1 route is derived like today's", () => {
    expect(shape("version021").status).toBe("route");
  });

  test("a user's bridge plus gas swap charts the solver route without counting the bridge", () => {
    expect(shape("userBridgeAndSwap")).toEqual({ status: "route", trades: [`${USD}→the-open-network`] });
  });

  test("1Click's own fee conversions and a pure bridge chart nothing", () => {
    expect(shape("feeConversion1cs")).toEqual({ status: "no-user", trades: [] });
    expect(shape("protocolFees")).toEqual({ status: "no-user", trades: [] });
    expect(shape("bridge")).toEqual({ status: "bridge", trades: [] });
  });
  test("recorded FastNEAR main swap plus gas top-up keeps both same-hash user legs", () => {
    const sample = gasRoutes[0]!;
    const diffs = diffsFromLogs(sample.logs.map(text => ({ ...sample, account: "intents.near", text })), detail => { throw new Error(detail); });
    const users = diffs.filter(diff => diff.referral);
    expect(users).toHaveLength(2);
    expect(users[0]!.intentHash).toBe(users[1]!.intentHash);
    expect(users[0]!.diff).not.toEqual(users[1]!.diff);
    expect(users.map(diff => [diff.logIndex, diff.item])).toEqual([[4, 0], [5, 0]]);
    const result = legs(diffs);
    expect(result.status).toBe("route");
    expect(result.trades.map(trade => [trade.index, trade.kind, trade.sold.group, trade.bought.group]))
      .toEqual([[0, "step", "ethereum", "solana"], [1, "step", "solana", "near"]]);
    // USDT hops within the same solver are not additional trades.
    expect(result.trades[0]!.sold.amount).toBe(2038035709746306n * 10n ** 18n);
    expect(result.trades[1]!.bought.amount).toBe(1941749514665484002156n * 10n ** 12n);
  });

  test("recorded FastNEAR bridge plus BNB gas does not drop the small stablecoin input", () => {
    const sample = gasRoutes[1]!;
    const diffs = diffsFromLogs(sample.logs.map(text => ({ ...sample, account: "intents.near", text })), detail => { throw new Error(detail); });
    const assets: Record<string, { group: string; decimals: number }> = {
      "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near": { group: USD, decimals: 6 },
      "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near": { group: USD, decimals: 6 },
      "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g": { group: USD, decimals: 18 },
      "nep245:v2_1.omni.hot.tg:56_11111111111111111111": { group: "binancecoin", decimals: 18 },
    };
    const result = receiptTrades(diffs, token => assets[token]);
    expect(result.status).toBe("route");
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      kind: "step", sold: { group: USD, amount: 9746n * 10n ** 30n },
      bought: { group: "binancecoin", amount: 13000013000014n * 10n ** 18n },
    });
  });

  test("an incomplete recorded gas route stays fallback rather than inventing a step", () => {
    const sample = gasRoutes[0]!;
    const diffs = diffsFromLogs(sample.logs.map(text => ({ ...sample, account: "intents.near", text })), detail => { throw new Error(detail); });
    const result = legs(diffs.filter(diff => diff.logIndex !== 2));
    expect(result.status).toBe("fallback");
    expect(result.trades.map(trade => [trade.kind, trade.sold.group, trade.bought.group]))
      .toEqual([["swap", "ethereum", "solana"], ["swap", "solana", "near"]]);
  });

  const diff = (account: string, referral: string, entries: [string, bigint][]): IntentDiff => ({
    height: 1, time: 1, txHash: "t", receiptId: "r", logIndex: 0, item: 0, intentHash: account, account, referral, diff: new Map(entries), fees: new Map(), version: "0.4.3",
  });
  const NEAR = "nep141:wrap.near", USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", ETH = "nep141:eth.omft.near";
  const E24 = 10n ** 24n, E6 = 10n ** 6n, E18 = 10n ** 18n;

  test("a fill split across two solvers charts both steps", () => {
    const result = legs([
      diff("s1", "", [[NEAR, 6n * E24], [USDC, -30n * E6]]),
      diff("s2", "", [[NEAR, 4n * E24], [USDC, -20n * E6]]),
      diff("u", "1click-swapkit", [[NEAR, -10n * E24], [USDC, 50n * E6]]),
    ]);
    expect(result.status).toBe("route");
    expect(result.trades.map(trade => [trade.sold.group, trade.sold.amount / 10n ** 36n, trade.bought.group, trade.bought.amount / 10n ** 36n])).toEqual([["near", 6n, USD, 30n], ["near", 4n, USD, 20n]]);
  });

  test("two users in one receipt fall back to each user's own swap", () => {
    const result = legs([
      diff("u1", "1click-swapkit", [[NEAR, -1n * E24], [USDC, 5n * E6]]),
      diff("u2", "1click-rango", [[USDC, -5n * E6], [NEAR, 1n * E24]]),
    ]);
    expect(result).toMatchObject({ status: "fallback", trades: [{ sold: { group: "near" }, bought: { group: USD } }, { sold: { group: USD }, bought: { group: "near" } }] });
  });

  test("steps that don't connect the user's input to the output fall back", () => {
    const result = legs([
      diff("s1", "", [[NEAR, 1n * E24], [ETH, -1n * E18]]),
      diff("u", "1click-swapkit", [[NEAR, -1n * E24], [USDC, 5n * E6]]),
    ]);
    expect(result.status).toBe("fallback");
    expect(result.trades.map(trade => `${trade.sold.group}→${trade.bought.group}`)).toEqual([`near→${USD}`]);
  });
});
