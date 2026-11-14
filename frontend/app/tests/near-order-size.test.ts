import { describe, expect, it } from "vitest";
import { affordableBuyQuantity, sizeForBalancePercent } from "@/lib/near/domain/order-size";

describe("balance percentage sizing", () => {
  it("sizes sells from the base balance and floors to six decimals", () => {
    expect(sizeForBalancePercent({ available: "2.123456789", percent: 100, side: "sell" })).toBe("2.123456");
    expect(sizeForBalancePercent({ available: "2", percent: 25, side: "sell" })).toBe("0.5");
  });
  it("sizes buys from the quote balance with a one percent reserve", () => {
    expect(sizeForBalancePercent({ available: "10", percent: 50, side: "buy", price: 5 })).toBe("0.99");
    expect(sizeForBalancePercent({ available: "10", percent: 100, side: "buy", price: "4" })).toBe("2.475");
  });
  it("uses the full balance for a quote-checked market buy and reduces an unaffordable quoted size", () => {
    expect(sizeForBalancePercent({ available: "0.8929", percent: 100, side: "buy", price: 4.4, reservePercent: 0 })).toBe("0.202931");
    const adjusted = affordableBuyQuantity({ quantity: "0.19707", available: "0.8929", quotedInput: "0.893918" });
    expect(Number(adjusted)).toBeLessThan(0.19707);
    expect(affordableBuyQuantity({ quantity: adjusted, available: "0.8929", quotedInput: "0.89" })).toBe("");
  });
  it("reduces to the selected budget even when the whole balance covers the quote", () => {
    expect(affordableBuyQuantity({ quantity: "1", available: "100", quotedInput: "50", percent: 25, decimals: 9 })).toBe("0.4995");
    expect(affordableBuyQuantity({ quantity: "1", available: "100", quotedInput: "20", percent: 25 })).toBe("");
    expect(affordableBuyQuantity({ quantity: "1", available: "100", quotedInput: "200", percent: 25 })).toBe("0.124875");
  });
  it("does not size from missing balances or invalid prices", () => {
    expect(sizeForBalancePercent({ available: "10", percent: 50, side: "buy" })).toBe("");
    expect(sizeForBalancePercent({ available: "10", percent: 50, side: "buy", price: "abc" })).toBe("");
    expect(sizeForBalancePercent({ available: "0", percent: 50, side: "sell" })).toBe("");
    expect(sizeForBalancePercent({ available: "10", percent: 0, side: "sell" })).toBe("");
  });
});
