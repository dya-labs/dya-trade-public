import { describe, expect, it } from "vitest";
import { markInsightsRead, unreadInsightIds, READ_INSIGHTS_KEY } from "@/lib/analysis/insight-read-state";
import { analysisStorage } from "@/lib/analysis/market-storage";

describe("insight read state", () => {
  it("persists read IDs per token and detects new or late-arriving records", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const btc = analysisStorage(storage, "btc");
    const sol = analysisStorage(storage, "sol");
    expect(unreadInsightIds(btc, ["first"])).toEqual(["first"]);
    markInsightsRead(btc, ["first"]);
    expect(unreadInsightIds(analysisStorage(storage, "btc"), ["first", "late"])).toEqual(["late"]);
    expect(unreadInsightIds(sol, ["first"])).toEqual(["first"]);
    markInsightsRead(btc, ["first", "late"]);
    expect(unreadInsightIds(btc, ["first", "late"])).toEqual([]);
  });
  it("treats malformed read state as unread", () => {
    expect(unreadInsightIds({ getItem: () => "invalid" }, ["a"])).toEqual(["a"]);
    expect(unreadInsightIds({ getItem: key => key === READ_INSIGHTS_KEY ? "{}" : null }, ["a"])).toEqual(["a"]);
  });
});
