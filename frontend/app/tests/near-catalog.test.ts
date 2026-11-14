// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { catalogSchema, DEFAULT_PAIR, makePair, quantityRaw, type CatalogAsset } from "@/lib/near/domain/catalog";
import { createCatalogReader, resolvePair } from "../../../backend/id/src/near/providers/catalog";
import { readBalances } from "../../../backend/id/src/near/providers/live";
import { marketQuoteRequest, previewMarket } from "../../../backend/id/src/near/services/one-click-market";
import { prepareExecutableMarketTrade, validateExecutableMarketTrade } from "../../../backend/id/src/near/services/market-execution";
import { marketReview, historicalMarketReview } from "@/lib/near/http/schemas/trading";
import { D } from "@/lib/near/domain/decimal";

const accountId = "0x" + "a".repeat(40);
const usdc: CatalogAsset = { assetId: "nep141:usdc.eth.omft.near", symbol: "USDC", blockchain: "eth", decimals: 6 };
const sol: CatalogAsset = { assetId: "nep141:sol.omft.near", symbol: "SOL", blockchain: "sol", decimals: 9 };

describe("catalog", () => {
  it("keeps same-symbol assets distinct and rejects malformed/duplicate metadata", async () => {
    const assets = [usdc, { ...usdc, assetId: "nep141:usdc.base.omft.near", blockchain: "base" }];
    expect(catalogSchema.parse(assets)).toHaveLength(2);
    expect(catalogSchema.safeParse([usdc, usdc]).success).toBe(false);
    expect(catalogSchema.safeParse([{ ...usdc, decimals: 1.5 }]).success).toBe(false);
    const pair = await resolvePair({ baseAssetId: assets[1].assetId, quoteAssetId: DEFAULT_PAIR.quote.assetId, decimals: 18 }, async () => [...assets, DEFAULT_PAIR.quote]);
    await expect(resolvePair({ baseAssetId: assets[1].assetId, quoteAssetId: usdc.assetId }, async () => assets)).rejects.toThrow();
    expect(pair.base.blockchain).toBe("base");
    expect(pair.base.decimals).toBe(6);
    await expect(resolvePair({ baseAssetId: "unknown", quoteAssetId: usdc.assetId }, async () => assets)).rejects.toThrow();
    await expect(resolvePair({ baseAssetId: usdc.assetId, quoteAssetId: usdc.assetId }, async () => assets)).rejects.toThrow();
    await expect(resolvePair({ baseAssetId: usdc.assetId }, async () => assets)).rejects.toThrow();
  });
  it("coalesces reads, expires cache, and fails closed rather than serving expired metadata", async () => {
    let now = 0;
    const fetcher = vi.fn(async () => Response.json([sol, usdc]));
    const read = createCatalogReader(fetcher, () => now);
    const results = await Promise.all([read(), read()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    results[0][0].decimals = 1;
    expect((await read())[0].decimals).toBe(9);
    now = 300_001;
    fetcher.mockResolvedValueOnce(Response.json({ error: "down" }, { status: 503 }));
    await expect(read()).rejects.toThrow("discovery unavailable");
    expect(await read()).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

it.each([0, 6, 7, 8, 9, 18, 24, 38])("preserves %i-decimal raw units without rounding", decimals => {
  const amount = decimals ? `0.${"0".repeat(decimals - 1)}1` : "1";
  expect(quantityRaw(amount, decimals)).toBe("1");
  expect(() => quantityRaw(decimals ? amount + "1" : "1.1", decimals)).toThrow();
  expect(() => quantityRaw("1e5", decimals)).toThrow();
  expect(() => quantityRaw("340282366920938463463374607431768211456", 0)).toThrow();
});

it("reads only selected balances and uses IDs and decimals from trusted metadata", async () => {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    expect(JSON.parse(Buffer.from(request.params.args_base64, "base64").toString()).token_ids).toEqual([sol.assetId, usdc.assetId]);
    return Response.json({ result: { block_height: 42, result: [...Buffer.from(JSON.stringify(["123456789", "0"]))] } });
  });
  const result = await readBalances(accountId, fetcher, [sol, usdc]);
  expect(result.assets.map(a => a.amount)).toEqual(["0.123456789", "0"]);
});

it.each([6, 8, 9, 18, 24])("binds a %i-decimal asset quote and signing payload to the selected pair", async decimals => {
  const pair = makePair({ ...sol, decimals }, usdc);
  const quantity = `0.${"0".repeat(decimals - 1)}1`;
  const balances = { accountId, checkedAt: 0, blockHeight: 42, assets: [
    { ...usdc, raw: "10000000", amount: "10" }, { ...pair.base, raw: "100", amount: new D(100).div(new D(10).pow(decimals)).toFixed() },
  ] };
  for (const side of ["buy", "sell"] as const) {
    const buy = side === "buy";
    const input = buy ? usdc : pair.base, output = buy ? pair.base : usdc;
    const inputRaw = buy ? "1000000" : "1", outputRaw = buy ? "1" : "1000000";
    const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      if (String(url).endsWith("/quote")) return Response.json({ quoteRequest: request, quote: {
        amountIn: inputRaw, amountInFormatted: new D(inputRaw).div(new D(10).pow(input.decimals)).toFixed(),
        amountOut: outputRaw, amountOutFormatted: new D(outputRaw).div(new D(10).pow(output.decimals)).toFixed(),
        minAmountOut: outputRaw, ...(request.dry ? {} : { depositAddress: "deposit.near", deadline: new Date(240000).toISOString() }),
      } });
      return Response.json({ correlationId: "test", intent: { standard: "webauthn", payload: JSON.stringify({
        signer_id: accountId, verifying_contract: "intents.near", deadline: new Date(180000).toISOString(), nonce: "test",
        intents: [{ intent: "transfer", receiver_id: "deposit.near", tokens: { [input.assetId]: inputRaw } }],
      }) } });
    });
    const preview = await previewMarket({ side, quantity }, balances, "test", fetcher, 0, pair);
    expect(preview.pair).toEqual(pair);
    // Signature verification is mocked here; no actual trades are submitted.
    const review = await prepareExecutableMarketTrade({ side, quantity }, balances, "test", fetcher, 0, () => true, pair);
    expect(marketReview.parse(review).pair).toEqual(pair);
    expect(historicalMarketReview.parse(review).pair).toEqual(pair);
    expect(validateExecutableMarketTrade(review, accountId, 1)).toBe(review);
    expect(() => validateExecutableMarketTrade({ ...review, pair: { ...pair, base: { ...pair.base, assetId: "wrong" } } }, accountId, 1)).toThrow();
    expect(marketQuoteRequest({ side, quantity }, accountId, 0, pair).amount).toBe("1");
  }
});

it("keeps the default pair and rejects an unavailable quote without allocating an intent", async () => {
  expect(await resolvePair({}, async () => [DEFAULT_PAIR.base, DEFAULT_PAIR.quote])).toEqual(DEFAULT_PAIR);
  const pair = makePair(sol, usdc);
  const balances = { accountId, checkedAt: 0, blockHeight: 42, assets: [{ ...usdc, amount: "10", raw: "10000000" }] };
  const fetcher = vi.fn(async () => Response.json({ error: "no route" }, { status: 400 }));
  await expect(previewMarket({ side: "buy", quantity: "1" }, balances, "test", fetcher, 0, pair)).rejects.toThrow("unavailable");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
