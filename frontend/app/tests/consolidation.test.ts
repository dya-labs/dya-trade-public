// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { prepareConsolidation, validateConsolidation } from "../../../backend/id/src/near/services/consolidation";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
const target = { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" };
const base = { ...target, assetId: "nep141:base-usdc", blockchain: "base" };
const bnb = { ...target, assetId: "nep245:hot:usdc", blockchain: "bsc", decimals: 18 };
const account = `0x${"a".repeat(40)}`;
const catalog = [target, base, bnb];
const balances = { accountId: account, blockHeight: 1, checkedAt: Date.now(), assets: [
  { ...base, raw: "2000000", amount: "2" }, { ...bnb, raw: "1000000000000000001", amount: "1.000000000000000001" },
] };
const inputs = [{ assetId: base.assetId, amount: "1" }, { assetId: bnb.assetId, amount: "1.000000000000000001" }];
function mockFetcher(transform = (q: Record<string, string>) => q) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { method, params } = JSON.parse(init!.body as string);
    if (method === "query") return Response.json({ result: { result: [...Buffer.from(JSON.stringify("12345678"))] } });
    expect(method).toBe("quote");
    const q = params[0];
    return Response.json({ result: [transform({ defuse_asset_identifier_in: q.defuse_asset_identifier_in, defuse_asset_identifier_out: q.defuse_asset_identifier_out, amount_in: q.exact_amount_in, amount_out: "999900", expiration_time: new Date(Date.now() + 120000).toISOString(), quote_hash: "a".repeat(43) })] });
  });
}
afterEach(() => vi.unstubAllEnvs());
it("combines two source assets into one exact signed token diff without losing precision", async () => {
  vi.stubEnv("ONE_CLICK_JWT", "test");
  const fetcher = mockFetcher();
  const p = await prepareConsolidation({ inputs }, account, catalog, balances, fetcher);
  expect(p.review.outputAmount).toBe("1.9998");
  expect(p.review.inputAmount).toBe("2.000000000000000001");
  expect(JSON.parse(p.payload).intents).toEqual([{ intent: "token_diff", diff: { [base.assetId]: "-1000000", [bnb.assetId]: "-1000000000000000001", [target.assetId]: "1999800" } }]);
  expect(p.quoteHashes).toHaveLength(2);
  expect(validateConsolidation(p, account)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  expect(() => validateConsolidation(p, `0x${"b".repeat(40)}`)).toThrow();
  expect(() => validateConsolidation(p, account, Date.parse(p.review.expiresAt))).toThrow();
  expect(() => validateConsolidation({ ...p, payload: p.payload.replace('"1999800"', '"1999801"') }, account)).toThrow();
});
it("rejects overspending, duplicate assets, canonical USDC and unsupported decimals before quoting", async () => {
  vi.stubEnv("ONE_CLICK_JWT", "test");
  const fetcher = mockFetcher();
  for (const invalid of [[inputs[0], inputs[0]], [{ assetId: base.assetId, amount: "3" }], [{ assetId: target.assetId, amount: "1" }], [{ assetId: base.assetId, amount: "0.0000001" }]]) {
    await expect(prepareConsolidation({ inputs: invalid }, account, catalog, balances, fetcher)).rejects.toThrow();
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects quotes for a different asset, amount, or an expired quote", async () => {
  vi.stubEnv("ONE_CLICK_JWT", "test");
  for (const patch of ([{ amount_in: "2" }, { defuse_asset_identifier_out: "nep141:wrong" }, { expiration_time: new Date(0).toISOString() }] as Record<string, string>[])) {
    await expect(prepareConsolidation({ inputs }, account, catalog, balances, mockFetcher(q => ({ ...q, ...patch })))).rejects.toThrow();
  }
});
it("excludes unavailable networks only when requested and never debits them", async () => {
  vi.stubEnv("ONE_CLICK_JWT", "test");
  const normal = mockFetcher();
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    if (body.method === "quote" && body.params[0].defuse_asset_identifier_in === bnb.assetId) return Response.json({ result: [] });
    return normal(url, init);
  });
  const prepared = await prepareConsolidation({ inputs, skipUnavailable: true }, account, catalog, balances, fetcher);
  expect(prepared.review.excluded?.[0].asset.assetId).toBe(bnb.assetId);
  expect(prepared.review.inputs).toHaveLength(1);
  expect(prepared.review.inputAmount).toBe("1");
  expect(JSON.parse(prepared.payload).intents[0].diff[bnb.assetId]).toBeUndefined();
  expect(validateConsolidation(prepared, account)).toBeTruthy();
  await expect(prepareConsolidation({ inputs }, account, catalog, balances, fetcher)).rejects.toThrow("No valid quote");
});
it("does not prepare a signature when every network has no quote", async () => {
  vi.stubEnv("ONE_CLICK_JWT", "test");
  const fetcher = vi.fn(async () => Response.json({ result: null }));
  await expect(prepareConsolidation({ inputs, skipUnavailable: true }, account, catalog, balances, fetcher)).rejects.toThrow("No network could provide a quote");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
