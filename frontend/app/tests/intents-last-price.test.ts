import { expect, it } from "vitest";
import { intentsLastPrice } from "@/lib/market-data/intents-last-price";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
const now = 1_800_000_000_000;
const quote = { ...DEFAULT_PAIR.quote, price: "0.98", priceUpdatedAt: new Date(now).toISOString() };
const trade = { time: now - 1000, price: "2450", quantity: "1", side: "buy" as const, txHash: "hash" };
it("uses the newest public trade and converts USD using the actual quote token price", () => {
  expect(intentsLastPrice([{ ...trade, time: now - 2000, price: "1960" }, trade], quote, now)).toBe(2500);
});
it("returns unavailable for stale trades or conversion prices, and missing data", () => {
  expect(intentsLastPrice([{ ...trade, time: now - 600_000 }], quote, now)).toBeNull();
  expect(intentsLastPrice([trade], { ...quote, priceUpdatedAt: new Date(now - 600_000).toISOString() }, now)).toBeNull();
  expect(intentsLastPrice(undefined, quote, now)).toBeNull();
  expect(intentsLastPrice([trade], undefined, now)).toBeNull();
  expect(intentsLastPrice([trade], { ...quote, price: "0" }, now)).toBeNull();
  expect(intentsLastPrice([{ ...trade, price: "0" }], quote, now)).toBeNull();
  expect(intentsLastPrice([{ ...trade, time: now + 120_000 }], quote, now)).toBeNull();
});
