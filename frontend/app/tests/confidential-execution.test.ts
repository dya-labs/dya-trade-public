// @vitest-environment node
import { expect, it, vi } from "vitest";
import { ASSETS, type LiveBalances } from "@/lib/near/domain/assets";
import { PRIVATE_VERIFIER, PRIVATE_SALT, privateAssetId } from "@/lib/near/domain/confidential";
import { versionedNonce } from "../../../backend/id/src/near/auth/intents";
import { prepareExecutableMarketTrade, validateExecutableMarketTrade } from "../../../backend/id/src/near/services/market-execution";
import { prepareWithdrawal, validateWithdrawal } from "../../../backend/id/src/near/services/one-click-withdraw";
import { depositQuote as depositQuoteSchema } from "../../../packages/wallet-contracts/src/http/schemas/transfers";
import { createDepositQuote } from "../../../backend/id/src/near/services/one-click-deposit";
const identity = "0x" + "a".repeat(40), receiver = "1".repeat(64), wallet = "0x" + "b".repeat(40);
const balances: LiveBalances = { accountId: identity, blockHeight: 0, checkedAt: 0, assets: ASSETS.map(a => ({ ...a, raw: a.symbol === "USDC" ? "1000000" : "0", amount: a.symbol === "USDC" ? "1" : "0" })) };
const tokens = [{ assetId: "nep141:bsc-usdc", blockchain: "bsc", symbol: "USDC", decimals: 6, price: 2 }];
// `outlivesQuote` mirrors live 1Click: the address expiry and signed intent run three days past the requested deadline.
function provider(kind: "market" | "withdraw" | "deposit", downgrade = false, publicIntent = false, outlivesQuote = false): typeof fetch {
  const signedDeadline = outlivesQuote ? 15 * 60_000 + 3 * 86_400_000 : 180000;
  return async (url, init) => {
    expect(String(url)).not.toContain("rpc");
    if (String(url).endsWith("/tokens")) return Response.json(tokens);
    const request = JSON.parse(String(init?.body));
    if (String(url).endsWith("/quote")) {
      if (kind === "deposit") { expect(request.swapType).toBe("FLEX_INPUT"); expect(request.refundTo).toBe("0x" + "d".repeat(40)); }
      expect(request.confidentiality).toBe("advanced");
      expect(request.depositType).toBe(kind === "deposit" ? "ORIGIN_CHAIN" : "CONFIDENTIAL_INTENTS");
      expect(request.recipientType).toBe(kind === "withdraw" ? "DESTINATION_CHAIN" : "CONFIDENTIAL_INTENTS");
      expect(request.refundType).toBe(kind === "deposit" ? "ORIGIN_CHAIN" : "CONFIDENTIAL_INTENTS");
      return Response.json({ correlationId: "quote", signature: "test-signature", quoteRequest: { ...request, ...(downgrade ? { confidentiality: "basic" } : {}) }, quote: {
        minAmountIn: "495000", amountIn: "500000", amountInFormatted: "0.5", amountOut: kind === "market" ? "100000000000000000000000" : "490000", amountOutFormatted: kind === "market" ? "0.1" : "0.49", minAmountOut: kind === "market" ? "99000000000000000000000" : "480000", depositAddress: receiver, deadline: new Date(outlivesQuote ? signedDeadline : 240000).toISOString(),
      } });
    }
    expect(String(url)).toContain("/generate-intent");
    expect(new Headers(init?.headers).get("X-API-Key")).toBe("test-key");
    return Response.json({ correlationId: "intent", intent: { standard: "webauthn", payload: JSON.stringify({ signer_id: identity, verifying_contract: publicIntent ? "intents.near" : PRIVATE_VERIFIER, nonce: versionedNonce(PRIVATE_SALT, signedDeadline), deadline: new Date(signedDeadline).toISOString(), intents: [{ intent: "transfer", receiver_id: receiver, tokens: { [privateAssetId(ASSETS[1].assetId)]: "500000" } }] }) } });
  };
}
it("prepares a confidential market transfer and rejects public contracts, downgrade and altered debits", async () => {
  const prepare = (fetcher: typeof fetch) => prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, balances, "test-key", fetcher, 0, () => true, undefined, true);
  const review = await prepare(provider("market"));
  expect(review.confidentiality).toBe("advanced");
  expect(validateExecutableMarketTrade(review, identity, 1)).toBe(review);
  await expect(prepare(provider("market", true))).rejects.toThrow("Public fallback");
  await expect(prepare(provider("market", false, true))).rejects.toThrow();
  const changed = JSON.parse(review.payload);
  changed.intents[0].tokens[privateAssetId(ASSETS[1].assetId)] = "999999";
  expect(() => validateExecutableMarketTrade({ ...review, payload: JSON.stringify(changed) }, identity, 1)).toThrow();
  changed.intents[0].tokens[privateAssetId(ASSETS[1].assetId)] = "500000";
  changed.intents[0].memo = "unexpected";
  expect(() => validateExecutableMarketTrade({ ...review, payload: JSON.stringify(changed) }, identity, 1)).toThrow();
});
it("withdraws only from private tokens and refunds to the private account", async () => {
  const prepare = (fetcher: typeof fetch) => prepareWithdrawal({ asset: "USDC", amount: "0.5", wallet }, balances, "test-key", fetcher, 0, undefined, true);
  const review = await prepare(provider("withdraw"));
  expect(review.confidentiality).toBe("advanced");
  expect(validateWithdrawal(review, identity, 1)).toBe(review);
  await expect(prepare(provider("withdraw", true))).rejects.toThrow("Public fallback");
  await expect(prepare(provider("withdraw", false, true))).rejects.toThrow();
});
it("expires trades and withdrawals at the requested deadline when 1Click's signed intent outlives it", async () => {
  const requested = new Date(15 * 60_000).toISOString();
  const trade = await prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, balances, "test-key", provider("market", false, false, true), 0, () => true, undefined, true);
  const withdrawal = await prepareWithdrawal({ asset: "USDC", amount: "0.5", wallet }, balances, "test-key", provider("withdraw", false, false, true), 0, undefined, true);
  expect([trade.expiresAt, withdrawal.deadline]).toEqual([requested, requested]);
  expect(() => validateExecutableMarketTrade(trade, identity, 15 * 60_000)).toThrow("deadline");
  expect(() => validateWithdrawal(withdrawal, identity, 15 * 60_000)).toThrow("deadline");
});
it("creates confidential deposits and refuses a downgraded provider response", async () => {
  const prepare = (fetcher: typeof fetch) => createDepositQuote({ amount: "0.5", wallet }, identity, "test-key", fetcher, 0, true, undefined, "0x" + "d".repeat(40));
  const quote = await prepare(provider("deposit"));
  expect(quote.confidentiality).toBe("advanced");
  expect(quote.minAmountInFormatted).toBe("0.495");
  expect(quote.showDollarBuffer).toBe(true);
  await expect(prepare(provider("deposit", true))).rejects.toThrow("Public fallback");
});

it("discovers technical minimums independently of the displayed $1 buffer", async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith("/tokens")) return Response.json(tokens);
    const request = JSON.parse(String(init?.body));
    requests.push(request.amount);
    if (requests.length === 1) return Response.json({ message: "Amount is too low for bridge, try at least 990000" }, { status: 400 });
    return Response.json({ correlationId: "quote", signature: "signature", quoteRequest: request, quote: {
      amountIn: "1000000", amountInFormatted: "1", amountOut: "1000000", amountOutFormatted: "1", minAmountIn: "990000", minAmountOut: "990000", depositAddress: receiver, deadline: new Date(240000).toISOString(),
    } });
  };
  const quote = await createDepositQuote({}, identity, "test-key", fetcher, 0, true, undefined, "0x" + "d".repeat(40));
  expect(requests).toEqual(["1", "1000000"]);
  expect(quote.minAmountInFormatted).toBe("0.99");
  expect(quote.showDollarBuffer).toBe(false);
});

it("preserves the exact stablecoin and network identity for confidential deposits", async () => {
  const stable = { assetId: "nep141:base-usdc", blockchain: "base", symbol: "USDC", decimals: 6, coingeckoId: "usd-coin" };
  const near = { ...stable, assetId: ASSETS[1].assetId, blockchain: "near" };
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith("/tokens")) return Response.json([stable, near]);
    const request = JSON.parse(String(init?.body));
    expect(request.originAsset).toBe(stable.assetId);
    expect(request.destinationAsset).toBe(stable.assetId);
    return Response.json({ correlationId: "quote", signature: "test-signature", quoteRequest: request, quote: { amountIn: "1000000", amountInFormatted: "1", amountOut: "990000", amountOutFormatted: "0.99", minAmountOut: "980000", minAmountIn: "100000", depositAddress: receiver, deadline: new Date(240000).toISOString() } });
  };
  await expect(createDepositQuote({ sourceAssetId: stable.assetId, targetAssetId: stable.assetId, amount: "1" }, identity, "test-key", fetcher, 0, true, undefined, "0x" + "d".repeat(40))).resolves.toMatchObject({ targetAssetId: stable.assetId });
  await expect(createDepositQuote({ sourceAssetId: stable.assetId, targetAssetId: near.assetId, amount: "1" }, identity, "test-key", fetcher, 0, true, undefined, "0x" + "d".repeat(40))).rejects.toThrow("preserve the source asset");
});
it("uses the server-configured refund address and rejects unconfigured confidential deposits before provider calls", async () => {
  const fetcher = vi.fn(provider("deposit"));
  await expect(createDepositQuote({ wallet }, identity, "test-key", fetcher, 0, true)).rejects.toThrow("Transfers on this network");
  expect(fetcher).not.toHaveBeenCalled();
  const quote = await createDepositQuote({ amount: "0.5", wallet: "0x" + "f".repeat(40), refundTo: "0x" + "f".repeat(40) }, identity, "test-key", fetcher, 0, true, undefined, "0x" + "d".repeat(40));
  expect(quote.refundTo).toBe("0x" + "d".repeat(40));
});

it("keeps historical confidential refund quotes readable after restoring native refunds", async () => {
  const native = await createDepositQuote({ amount: "0.5", refundType: "CONFIDENTIAL_INTENTS", refundTo: "dya-trade.sputnik-dao.near" }, identity, "synthetic", provider("deposit"), 0, true, undefined, "0x" + "d".repeat(40));
  expect(native).toMatchObject({ refundTo: "0x" + "d".repeat(40), refundType: "ORIGIN_CHAIN" });
  const historical = { ...native, refundTo: "dya-trade.sputnik-dao.near", refundType: "CONFIDENTIAL_INTENTS" };
  expect(depositQuoteSchema.parse(historical)).toMatchObject({ refundTo: historical.refundTo, refundType: historical.refundType });
});
