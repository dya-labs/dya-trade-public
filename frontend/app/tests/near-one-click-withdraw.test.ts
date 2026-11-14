// @vitest-environment node
import { withdrawalReview as responseSchema } from "@/lib/near/http/schemas/transfers";
import { describe, expect, it, vi } from "vitest";
import { ASSETS, type LiveBalances } from "@/lib/near/domain/assets";
import { prepareWithdrawal, publishWithdrawal, validateWithdrawal } from "../../../backend/id/src/near/services/one-click-withdraw";
import type { SignedWebAuthn } from "../../../backend/id/src/near/auth/intents";

const accountId = "0x" + "a".repeat(40);
const wallet = "0x" + "B".repeat(40);
const depositAddress = "withdrawal.near";
const balances: LiveBalances = { accountId, blockHeight: 42, checkedAt: 0, assets: [
  { ...ASSETS[0], raw: "0", amount: "0" }, { ...ASSETS[1], raw: "1000000", amount: "1" },
] };
function fetcher(options: { wrongRecipient?: boolean; wrongDebit?: boolean; memo?: boolean } = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/tokens")) return Response.json([{ blockchain: "bsc", symbol: "USDC", assetId: "nep141:bsc-usdc.omft.near", decimals: 6 }]);
    const request = JSON.parse(String(init?.body));
    if (String(url).endsWith("/quote")) {
      expect(request).toMatchObject({ dry: false, swapType: "EXACT_INPUT", depositType: "INTENTS", originAsset: ASSETS[1].assetId, amount: "500000", recipient: wallet, recipientType: "DESTINATION_CHAIN", refundTo: accountId, refundType: "INTENTS" });
      return Response.json({ quoteRequest: { ...request, ...(options.wrongRecipient ? { recipient: "0x" + "C".repeat(40) } : {}) }, quote: { amountIn: "500000", amountOut: "480000", minAmountOut: "470000", depositAddress, deadline: new Date(240_000).toISOString(), ...(options.memo ? { depositMemo: "memo" } : {}) } });
    }
    expect(request).toEqual({ type: "swap_transfer", standard: "webauthn", signerId: accountId, depositAddress });
    return Response.json({ correlationId: "intent-1", intent: { standard: "webauthn", payload: JSON.stringify({ signer_id: accountId, verifying_contract: "intents.near", deadline: new Date(180_000).toISOString(), nonce: "nonce", intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [ASSETS[1].assetId]: options.wrongDebit ? "1" : "500000" } }] }) } });
  });
}
describe("1Click USDC withdrawal", () => {
  it("binds BSC destination, exact debit, and provider signing payload", async () => {
    const mock = fetcher();
    const review = await prepareWithdrawal({ asset: "USDC", wallet, amount: "0.5" }, balances, "jwt", mock, 0);
    expect(() => responseSchema.parse(JSON.parse(JSON.stringify(review)))).not.toThrow();
    expect(mock).toHaveBeenCalledTimes(3);
    expect(review).toMatchObject({ amount: "0.5", expectedReceive: "0.48", minimumReceive: "0.47", destinationWallet: wallet, deadline: new Date(180_000).toISOString() });
    expect(validateWithdrawal(review, accountId, 1)).toBe(review);
  });
  it("rejects insufficient funds and provider changes", async () => {
    await expect(prepareWithdrawal({ asset: "USDC", wallet, amount: "2" }, balances, "jwt", fetcher(), 0)).rejects.toThrow("Insufficient");
    await expect(prepareWithdrawal({ asset: "USDC", wallet, amount: "0.5" }, balances, "jwt", fetcher({ wrongRecipient: true }), 0)).rejects.toThrow("does not match");
    await expect(prepareWithdrawal({ asset: "USDC", wallet, amount: "0.5" }, balances, "jwt", fetcher({ wrongDebit: true }), 0)).rejects.toThrow("differs from review");
    await expect(prepareWithdrawal({ asset: "USDC", wallet, amount: "0.5" }, balances, "jwt", fetcher({ memo: true }), 0)).rejects.toThrow("Memo-based");
  });
  it("submits only signed data to 1Click", async () => {
    const signed = { standard: "webauthn", payload: "{}", public_key: "p256:key", signature: "p256:sig", client_data_json: "{}", authenticator_data: "data" } satisfies SignedWebAuthn;
    const result = await publishWithdrawal(signed, "jwt", async (url, init) => {
      expect(String(url)).toContain("/submit-intent");
      expect(JSON.parse(String(init?.body))).toEqual({ type: "swap_transfer", signedData: signed });
      return Response.json({ intentHash: "4".repeat(44) });
    });
    expect(result.intentHash).toBe("4".repeat(44));
  });
});


describe("1Click wNEAR withdrawal to a NEAR wallet", () => {
  const nearWallet = "alice.near";
  const nearBalances: LiveBalances = { ...balances, assets: [
    { ...ASSETS[0], raw: "200000000000000000000000", amount: "0.2" }, balances.assets[1],
  ] };
  function nearFetcher(registered = true) {
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("rpc")) return Response.json({ result: { result: Array.from(Buffer.from(JSON.stringify(registered ? { total: "1", available: "0" } : null))) } });
      if (String(url).endsWith("/tokens")) return Response.json([{ blockchain: "near", symbol: "wNEAR", assetId: ASSETS[0].assetId, decimals: 24 }]);
      const request = JSON.parse(String(init?.body));
      if (String(url).endsWith("/quote")) {
        expect(request).toMatchObject({ dry: false, swapType: "EXACT_INPUT", originAsset: ASSETS[0].assetId, destinationAsset: ASSETS[0].assetId, amount: "100000000000000000000000", recipient: nearWallet, recipientType: "DESTINATION_CHAIN" });
        return Response.json({ quoteRequest: request, quote: { amountIn: "100000000000000000000000", amountOut: "99000000000000000000000", minAmountOut: "98000000000000000000000", depositAddress, deadline: new Date(240_000).toISOString() } });
      }
      expect(request).toEqual({ type: "swap_transfer", standard: "webauthn", signerId: accountId, depositAddress });
      return Response.json({ correlationId: "near-intent", intent: { standard: "webauthn", payload: JSON.stringify({ signer_id: accountId, verifying_contract: "intents.near", deadline: new Date(180_000).toISOString(), nonce: "nonce", intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [ASSETS[0].assetId]: "100000000000000000000000" } }] }) } });
    });
  }
  it("checks the recipient's wNEAR registration and exact signed debit", async () => {
    const fetcher = nearFetcher();
    const review = await prepareWithdrawal({ asset: "wNEAR", wallet: nearWallet, amount: "0.1" }, nearBalances, "jwt", fetcher, 0);
    expect(() => responseSchema.parse(JSON.parse(JSON.stringify(review)))).not.toThrow();
    expect(review).toMatchObject({ asset: "wNEAR", destinationChain: "NEAR", destinationWallet: nearWallet, amount: "0.1", expectedReceive: "0.099", minimumReceive: "0.098" });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(validateWithdrawal(review, accountId, 1)).toBe(review);
    expect(() => validateWithdrawal({ ...review, destinationAsset: "nep141:other.near" }, accountId, 1)).toThrow();
  });
  it("rejects an unregistered NEAR recipient before requesting a quote", async () => {
    const fetcher = nearFetcher(false);
    await expect(prepareWithdrawal({ asset: "wNEAR", wallet: nearWallet, amount: "0.1" }, nearBalances, "jwt", fetcher, 0)).rejects.toThrow("not registered");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("catalog-selected withdrawal routes", () => {
  const origin = { ...ASSETS[1], blockchain: "near", coingeckoId: "usd-coin" };
  const destination = { ...origin, assetId: "nep141:base-usdc", blockchain: "base" };
  const catalog = [origin, destination];
  it("supports Base and binds the exact selected token, chain, address and debit", async () => {
    const legacy = fetcher();
    const mock: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/tokens")) return Response.json(catalog);
      if (String(url).endsWith("/quote")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ destinationAsset: destination.assetId, recipient: wallet, slippageTolerance: 100 });
      }
      return legacy(url, init);
    };
    const review = await prepareWithdrawal({ originAssetId: origin.assetId, destinationAssetId: destination.assetId, wallet, amount: "0.5" }, balances, "jwt", mock, 0, catalog);
    expect(review.destinationChain).toBe("Base");
    expect(responseSchema.parse(review).route?.destination.assetId).toBe(destination.assetId);
    expect(validateWithdrawal(review, accountId, 1)).toBe(review);
    expect(() => validateWithdrawal({ ...review, destinationChain: "Solana" }, accountId, 1)).toThrow();
    expect(() => validateWithdrawal({ ...review, amountRaw: "1" }, accountId, 1)).toThrow();
  });
  it("rejects mismatched token identities and unknown routes before requesting quotes", async () => {
    const mock = fetcher();
    const fake = { ...destination, coingeckoId: "another-token" };
    await expect(prepareWithdrawal({ originAssetId: origin.assetId, destinationAssetId: destination.assetId, wallet, amount: "0.5" }, balances, "jwt", mock, 0, [origin, fake])).rejects.toThrow("supported token");
    await expect(prepareWithdrawal({ originAssetId: origin.assetId, destinationAssetId: "unknown", wallet, amount: "0.5" }, balances, "jwt", mock, 0, catalog)).rejects.toThrow("supported token");
    expect(mock).not.toHaveBeenCalled();
  });
});
