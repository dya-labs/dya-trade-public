import { expect, it } from "vitest";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { limitMinimumSuggestion } from "@/components/near/limit-minimum-suggestion";

const now = Date.now();
const pair = { ...DEFAULT_PAIR,
  base: { ...DEFAULT_PAIR.base, price: "4.73", priceUpdatedAt: new Date(now).toISOString() },
  quote: { ...DEFAULT_PAIR.quote, price: "0.999662", priceUpdatedAt: new Date(now).toISOString() },
};
it("suggests a practical quote minimum above the USD boundary without assuming a peg", () => {
  expect(limitMinimumSuggestion("0.1", pair, "quote", "4.73428", now)).toBe("0.11");
});
it("suggests base units and accounts for an order away from the current market price", () => {
  expect(limitMinimumSuggestion("0.1", pair, "base", "4", now)).toBe("0.026");
});
it("rounds up even for tokens with zero decimals", () => {
  expect(limitMinimumSuggestion("0.1", { ...pair, base: { ...pair.base, decimals: 0 } }, "base", "4", now)).toBe("1");
});
it("does not suggest a value without fresh usable pricing", () => {
  for (const base of [{ ...pair.base, price: undefined }, { ...pair.base, price: 0 }, { ...pair.base, priceUpdatedAt: new Date(now - 600001).toISOString() }]) {
    expect(limitMinimumSuggestion("0.1", { ...pair, base }, "base", "4", now)).toBeUndefined();
  }
});
