import { expect, it } from "vitest";
import { feedState, overallHealth } from "@/components/near/data-status";
it("marks a cold CoinGecko failure amber even when Binance is live", () => {
  expect(overallHealth([{ name: "Binance", state: "Live" }, { name: "CoinGecko", state: feedState(false, false, false) }])).toEqual({ label: "CoinGecko unavailable", color: "bg-warning" });
});
it("distinguishes stale data, initial loading, recovery and essential outages", () => {
  expect(feedState(false, true, true)).toBe("Delayed");
  expect(feedState(false, true, false, false)).toBe("Delayed");
  expect(overallHealth([{ name: "feed", state: "Checking" }]).label).toBe("Checking data");
  expect(overallHealth([{ name: "feed", state: "Live" }]).label).toBe("Online");
  expect(overallHealth([{ name: "catalog", essential: true, state: "Unavailable" }]).color).toBe("bg-destructive");
});
