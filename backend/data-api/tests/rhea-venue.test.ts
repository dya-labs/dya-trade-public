import { describe, expect, test } from "bun:test";
import type { ClickHouse } from "../src/clickhouse";
import { units } from "../src/candles/bar";
import { DAY, MINUTE } from "../src/candles/kline";
import type { OnchainPair } from "../src/registry-types";
import { swapTrade } from "../src/venues/rhea/price";
import type { Swap } from "../src/venues/rhea/swaps";
import { rollingTicker } from "../src/live/rolling";
import { createRheaRest } from "../src/venues/rhea/venue";

const BLACKDRAGON: OnchainPair = { base: "blackdragon.tkn.near", quote: "wrap.near", baseDecimals: 24, quoteDecimals: 24 };
const SHITZU: OnchainPair = { base: "token.0xshitzu.near", quote: "wrap.near", baseDecimals: 18, quoteDecimals: 24 };
const M0 = 1_791_983_880_000; // 2026-10-14T13:18:00Z, a whole minute
const swap = (fields: Partial<Swap>): Swap => ({ height: 1, time: M0, txHash: "t", receiptId: "r", logIndex: 0, contract: "classic", poolId: "", tokenIn: "", tokenOut: "", amountIn: 0n, amountOut: 0n, ...fields });

describe("Rhea USD conversion", () => {
  // Rhea swap DNZvsASrcGMmghbXnWaCg8ZiTnutK8GaE6tJzGtsBsaW: 4823652986.07059 BLACKDRAGON sold for
  // 9.90933311327841 wNEAR, at 0.00000000205432130833082 wNEAR or $0.0000000101072608369876 with NEAR at $4.92.
  test("a sell of a 24-decimal token: exact price in USD and truncated quantity", () => {
    const trade = swapTrade(swap({ tokenIn: BLACKDRAGON.base, amountIn: 4823652986070590000000000000000000n, tokenOut: "wrap.near", amountOut: 9909333113278410000000000n }), BLACKDRAGON, units("4.92"));
    expect(trade).toEqual({ time: M0, price: "0.000000010107260837", quantity: "4823652986.07059", count: 1, takerBuy: false });
  });

  test("a buy of an 18-decimal token against 24-decimal wNEAR", () => {
    // 2 wNEAR for 1000 SHITZU at NEAR $5 is $0.01 per SHITZU.
    const trade = swapTrade(swap({ tokenIn: "wrap.near", amountIn: 2n * 10n ** 24n, tokenOut: SHITZU.base, amountOut: 1000n * 10n ** 18n }), SHITZU, units("5"));
    expect(trade).toMatchObject({ price: "0.01", quantity: "1000", takerBuy: true });
  });
});

/** Fake ClickHouse answering the venue's queries by table. */
function store(options: { cursor?: number; switchAt?: number; near?: { time: number; close: string }[]; nearSyncedTo?: number; swaps?: object[] }) {
  const queries: string[] = [];
  const clickhouse = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("FROM rhea_state")) return [
        ...(options.cursor === undefined ? [] : [{ key: "cursor", height: 10, time: options.cursor }]),
        ...(options.switchAt === undefined ? [] : [{ key: "switch", height: 5, time: options.switchAt }]),
      ];
      if (sql.includes("FROM klines_1m")) return options.near ?? [];
      if (sql.includes("FROM sync_state")) return [{ synced: options.nearSyncedTo ?? 0 }];
      if (sql.includes("FROM rhea_swaps")) return options.swaps ?? [];
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as ClickHouse;
  return { clickhouse, queries };
}

function rest(clickhouse: ClickHouse) {
  const venue = createRheaRest({ clickhouse, redisUrl: "redis://unused", intentsExplorerJwt: undefined, neardata: { url: "https://neardata.invalid", apiKey: undefined } },
    { pairs: async () => new Map([["BLACKDRAGON_WNEAR", BLACKDRAGON]]) });
  return { venue };
}

describe("Rhea candles", () => {
  test("before the switch point: no candles, the page ends at the switch minute", async () => {
    const { clickhouse, queries } = store({ cursor: M0 + 2 * DAY, switchAt: M0 + 10 * MINUTE });
    const { venue } = rest(clickhouse);
    expect(await venue.candles("BLACKDRAGON_WNEAR", "1m", M0, M0 + DAY)).toEqual({ klines: [], coveredTo: M0 + 10 * MINUTE });
    expect(queries.some(sql => sql.includes("FROM rhea_swaps"))).toBe(false);
  });

  test("from the switch point: stored swaps of the pair fold into USD minutes with counts and taker volume", async () => {
    const swaps = [
      { height: 1, time: M0 + 1000, receipt: "a", index: 0, tokenIn: "wrap.near", tokenOut: BLACKDRAGON.base, amountIn: "2000000000000000000000000", amountOut: "1000000000000000000000000000000000" },
      { height: 2, time: M0 + 2000, receipt: "b", index: 0, tokenIn: BLACKDRAGON.base, tokenOut: "wrap.near", amountIn: "1000000000000000000000000000000000", amountOut: "1000000000000000000000000" },
    ];
    const { clickhouse } = store({ cursor: M0 + 3 * MINUTE + 5000, switchAt: M0, near: [{ time: M0, close: "5" }], nearSyncedTo: M0 + 2 * MINUTE, swaps });
    const { venue } = rest(clickhouse);
    const page = await venue.candles("BLACKDRAGON_WNEAR", "1m", M0, M0 + DAY);
    // Limited by NEARUSDC's stored minutes (2) before the swap cursor's minute (3).
    expect(page.coveredTo).toBe(M0 + 2 * MINUTE);
    // 2 wNEAR for 1e9 tokens at $5 = $0.00000001; then 1 wNEAR for 1e9 = $0.000000005.
    expect(page.klines).toEqual([{ openTime: M0, open: "0.00000001", high: "0.00000001", low: "0.000000005", close: "0.000000005", volume: "2000000000", quoteVolume: "15", trades: 2, takerBuyVolume: "1000000000", takerBuyQuoteVolume: "10" }]);
  });

  test("nothing settled past `from` yet: an empty page that ends where it began", async () => {
    const { clickhouse } = store({ cursor: M0 + 30_000, switchAt: M0 - DAY, near: [], nearSyncedTo: M0 + MINUTE });
    const { venue } = rest(clickhouse);
    expect(await venue.candles("BLACKDRAGON_WNEAR", "1m", M0, M0 + DAY)).toEqual({ klines: [], coveredTo: M0 });
  });

  test("history starts at the indexer's switch point, unknown until it is fixed", async () => {
    expect(await rest(store({}).clickhouse).venue.earliest("BLACKDRAGON_WNEAR", "1m")).toBeNull();
    expect(await rest(store({ cursor: M0, switchAt: M0 }).clickhouse).venue.earliest("BLACKDRAGON_WNEAR", "1m")).toBe(M0);
  });
});

describe("Rhea rolling ticker", () => {
  const bar = (openTime: number, open: string, close: string, volume: string) => ({ openTime, open, high: close > open ? close : open, low: close < open ? close : open, close, volume, quoteVolume: volume, trades: 1, takerBuyVolume: "0", takerBuyQuoteVolume: "0" });
  test("uses traded minutes of the last 24 hours only", () => {
    const now = M0 + DAY + 30_000;
    const ticker = rollingTicker("X", [bar(M0, "9", "9", "5"), bar(M0 + 2 * MINUTE, "2", "3", "1"), bar(M0 + 3 * MINUTE, "3", "3", "0"), bar(M0 + 4 * MINUTE, "3", "4", "2")], "1", now);
    expect(ticker).toMatchObject({ openPrice: "2", lastPrice: "4", highPrice: "4", lowPrice: "2", volume: "3", changePercent: 100 });
  });
  test("a market without trades in 24 hours keeps its last close", () => {
    expect(rollingTicker("X", [], "0.5", M0)).toMatchObject({ lastPrice: "0.5", openPrice: "0.5", volume: "0", changePercent: 0 });
    expect(rollingTicker("X", [], undefined, M0)).toBeUndefined();
  });
});
