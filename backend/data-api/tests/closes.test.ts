import { expect, test } from "bun:test";
import { marketCloses } from "../src/candles/closes";
import { MINUTE } from "../src/candles/kline";
import type { ClickHouse } from "../src/clickhouse";

const M0 = Date.UTC(2026, 9, 16, 11, 0);

test("closes are keyed by minute open time when the window starts mid-minute", async () => {
  const clickhouse = {
    query: async (sql: string) => sql.includes("klines_1m")
      ? [{ time: M0, close: "1.5" }, { time: M0 + 2 * MINUTE, close: "1.7" }]
      : [{ synced: M0 + 3 * MINUTE }],
  } as unknown as ClickHouse;
  // A trade's exact time, as `recentTrades` passes it.
  const { closes } = await marketCloses(clickhouse, { venue: "binance", symbol: "NEARUSDC" }, M0 + 35_014, M0 + 3 * MINUTE);
  expect([...closes]).toEqual([[M0, "1.5"], [M0 + MINUTE, "1.5"], [M0 + 2 * MINUTE, "1.7"]]);
});
