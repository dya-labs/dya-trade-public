// @vitest-environment node
import { expect, it, vi } from "vitest";
import { fundingAssets } from "@/lib/near/domain/funding-balances";
import { prepareFundingBatch, publicFundingBatch, fundingBatchState } from "../../../backend/id/src/near/services/funding-conversions";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { AppError, ErrorCode } from "@/lib/near/domain/errors";
import { catalog, identity, source, other, balances, trade } from "./fixtures/funding";
const inputs = [source, other].map(a => ({ assetId: a.assetId, amount: "1" }));
it("classifies stablecoins by trusted metadata, never their price or symbol alone", () => {
  expect(fundingAssets([...catalog, { ...source, assetId: "fake", coingeckoId: "fake", price: 1 }, { ...DEFAULT_PAIR.base, price: 1 }]).map(a => a.assetId)).toEqual([source.assetId, other.assetId]);
});
it("quotes all exact balances to NEAR USDC and strips signing payloads from review", async () => {
  const prepare = vi.fn(async (...args: Parameters<typeof import("../../../backend/id/src/near/services/market-execution").prepareExecutableMarketTrade>) => { expect(args[7]).toBe(true); expect(args[6]?.quote.assetId).toBe(DEFAULT_PAIR.quote.assetId); return trade(args[6]!.base); });
  const result = await prepareFundingBatch({ inputs }, identity, catalog, balances, prepare);
  expect(result.outputAmount).toBe("1.998"); expect(result.minimumOutput).toBe("1.98");
  expect(result.costUsd).toBe("0.002"); expect(prepare).toHaveBeenCalledTimes(2);
  expect(publicFundingBatch(result).legs[0].review).not.toHaveProperty("payload");
});
it("excludes unavailable routes but rejects a tampered payload or public fallback", async () => {
  const result = await prepareFundingBatch({ inputs }, identity, catalog, balances, async (...args) => { if (args[6]?.base.assetId === other.assetId) throw new AppError(ErrorCode.ExecutableMarketQuoteUnavailable); return trade(); });
  expect(result.excluded[0].asset.assetId).toBe(other.assetId); expect(result.outputAmount).toBe("0.999");
  await expect(prepareFundingBatch({ inputs }, identity, catalog, balances, async () => ({ ...trade(), confidentiality: undefined }))).rejects.toThrow();
  await expect(prepareFundingBatch({ inputs }, identity, catalog, balances, async () => ({ ...trade(), payload: "{}" }))).rejects.toThrow();
  await expect(prepareFundingBatch({ inputs }, identity, catalog, balances, async () => { throw new AppError(ErrorCode.ExecutableMarketQuoteUnavailable); })).rejects.toThrow("remain in Funding");
});
it.each([
  [{ assetId: source.assetId, amount: "2" }],
  [{ assetId: source.assetId, amount: "0.0000001" }],
  [{ assetId: DEFAULT_PAIR.quote.assetId, amount: "1" }],
  [inputs[0], inputs[0]],
].map(inputs => ({ inputs })))("rejects overspending, excess precision, trading funds and duplicates before quoting: %j", async ({ inputs: selected }) => {
  const prepare = vi.fn();
  await expect(prepareFundingBatch({ inputs: selected }, identity, catalog, balances, prepare)).rejects.toThrow();
  expect(prepare).not.toHaveBeenCalled();
});
it("does not assume a depegged funding token is worth a dollar", async () => {
  const result = await prepareFundingBatch({ inputs: [inputs[0]] }, identity, [{ ...source, price: 0.9 }, DEFAULT_PAIR.quote], balances, async () => trade());
  expect(result.inputUsd).toBe("0.9"); expect(result.costUsd).toBe("-0.099");
});
it("never represents mixed outcomes as complete", () => {
  expect(fundingBatchState([{ state: "settled" }, { state: "cancelled" }])).toBe("partial");
  expect(fundingBatchState([{ state: "settled" }, { state: "unknown" }])).toBe("unknown");
});
