import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import type { FeePlan } from "../../../packages/wallet-contracts/src/domain/trading-fees";
// @vitest-environment node
import { marketPreview as responseSchema } from "@/lib/near/http/schemas/trading";
import { describe, expect, it, vi } from "vitest";
import { ASSETS, type LiveBalances } from "@/lib/near/domain/assets";
import { marketQuoteRequest, previewMarket } from "../../../backend/id/src/near/services/one-click-market";

const accountId = "0x" + "a".repeat(40);
const balances: LiveBalances = {
  accountId, blockHeight: 123, checkedAt: 1,
  assets: [
    { ...ASSETS[0], raw: "2000000000000000000000000", amount: "2" },
    { ...ASSETS[1], raw: "10000000", amount: "10" },
  ],
};

function quoteResponse(request: ReturnType<typeof marketQuoteRequest>, patch: Record<string, unknown> = {}) {
  const buy = request.swapType === "EXACT_OUTPUT";
  return {
    correlationId: "quote-1", timestamp: new Date(0).toISOString(), signature: "provider-signature",
    quoteRequest: request,
    quote: {
      amountIn: buy ? "4200000" : request.amount,
      amountInFormatted: buy ? "4.2" : "1",
      amountInUsd: "4.2", minAmountIn: buy ? "4200000" : request.amount,
      amountOut: buy ? request.amount : "4200000",
      amountOutFormatted: buy ? "1" : "4.2",
      amountOutUsd: "4.2", minAmountOut: buy ? "990000000000000000000000" : "4158000",
      timeEstimate: 2,
      ...patch,
    },
  };
}

describe("1Click market quote adapter", () => {
  it("maps buys to exact output and sells to exact input using only Intents accounts", () => {
    const buy = marketQuoteRequest({ side: "buy", quantity: "1" }, accountId, 0);
    expect(buy).toMatchObject({ dry: true, quoteWaitingTimeMs: 1000, swapType: "EXACT_OUTPUT", originAsset: ASSETS[1].assetId, destinationAsset: ASSETS[0].assetId, amount: "1000000000000000000000000", depositType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS", recipientType: "CONFIDENTIAL_INTENTS", refundTo: accountId, recipient: accountId });
    const sell = marketQuoteRequest({ side: "sell", quantity: "1" }, accountId, 0);
    expect(sell).toMatchObject({ swapType: "EXACT_INPUT", originAsset: ASSETS[0].assetId, destinationAsset: ASSETS[1].assetId });
  });

  it("fails closed without a JWT and never reaches the provider", async () => {
    const fetcher = vi.fn();
    await expect(previewMarket({ side: "buy", quantity: "1" }, balances, "", fetcher)).rejects.toThrow("ONE_CLICK_JWT");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requests a bearer-authenticated dry quote and calculates the balance shortfall", async () => {
    const request = marketQuoteRequest({ side: "buy", quantity: "1" }, accountId, 0);
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-jwt" });
      expect(JSON.parse(init?.body as string)).toEqual(request);
      return Response.json(quoteResponse(request));
    });
    const preview = await previewMarket({ side: "buy", quantity: "1" }, balances, "test-jwt", fetcher, 0);
    expect(() => responseSchema.parse(JSON.parse(JSON.stringify(preview)))).not.toThrow();
    expect(fetcher.mock.calls[0][0]).toBe("https://1click.chaindefuser.com/v0/quote");
    expect(preview).toMatchObject({ orderType: "market", side: "buy", principal: "4.2", estimatedOutput: "1", minimumOutput: "0.99", shortfall: "0", submissionEnabled: false, slippageBps: 30, slippagePolicy: { mode: "default" } });
  });

  it("rejects a quote whose echoed request or preview mode differs", async () => {
    const request = marketQuoteRequest({ side: "sell", quantity: "1" }, accountId, 0);
    await expect(previewMarket({ side: "sell", quantity: "1" }, balances, "jwt", async () => Response.json({ ...quoteResponse(request), quoteRequest: { ...request, recipient: "0x" + "b".repeat(40) } }), 0)).rejects.toThrow("does not match");
    await expect(previewMarket({ side: "sell", quantity: "1" }, balances, "jwt", async () => Response.json(quoteResponse(request, { depositAddress: "intents.near" })), 0)).rejects.toThrow("executable quote");
    await expect(previewMarket({ side: "sell", quantity: "1" }, balances, "jwt", async () => Response.json({ ...quoteResponse(request), quoteRequest: { ...request, slippageTolerance: 100 } }), 0)).rejects.toThrow("does not match");
  });
});

it("only exposes a fee receipt for a signature-verified dry quote within the target", async()=>{
  const plan:FeePlan={kind:"market",revision:1,maxTotalBps:25,recipient:"treasury.near",requestedDyaBps:5};
  const request=marketQuoteRequest({side:"buy",quantity:"1"},accountId,0);
  const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(String(init?.body));
    expect(input.appFees).toEqual([{recipient:plan.recipient,fee:5}]);
    const response=quoteResponse(request,{refundFee:"0",withdrawFee:"0"});
    response.quoteRequest={...input,appFees:[...input.appFees,{recipient:"provider.near",fee:20}]};
    return Response.json(response);
  });
  const args=[{side:"buy",quantity:"1"},balances,"synthetic",transport,0,DEFAULT_PAIR,plan] as const;
  await expect(previewMarket(...args,()=>false)).rejects.toThrow("signature is invalid");
  expect((await previewMarket(...args,()=>true)).feeReceipt).toMatchObject({plan,totalBps:25});
  await expect(previewMarket({side:"buy",quantity:"1"},balances,"synthetic",transport,0,DEFAULT_PAIR,{...plan,maxTotalBps:5},()=>true)).rejects.toThrow("fee allocation");
});

it("logs the provider rejection reason without credentials, accounts or extra response fields", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const transport = vi.fn(async () => Response.json({ code: "AMOUNT_TOO_LOW", message: `Amount is below minimum for ${accountId}. synthetic-credential`, request: { private: "do-not-log" } }, { status: 400 }));
  try {
    await expect(previewMarket({side:"buy",quantity:"0.1"}, balances, "synthetic-credential", transport)).rejects.toThrow();
    expect(warning).toHaveBeenCalledWith("trading.quote.preview_rejected", { status: 400, providerCode: "AMOUNT_TOO_LOW", reason: "Amount is below minimum for [redacted]. [redacted]" });
    const logs = JSON.stringify(warning.mock.calls);
    expect(logs).not.toContain(accountId);
    expect(logs).not.toContain("synthetic-credential");
    expect(logs).not.toContain("do-not-log");
    expect(transport).toHaveBeenCalledOnce();
  } finally { warning.mockRestore(); }
});

it("maps a recognized liquidity rejection to a safe user-facing code", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const transport = vi.fn(async () => Response.json({message:"No liquidity available"}, {status:400}));
    await expect(previewMarket({side:"buy",quantity:"0.1"},balances,"synthetic",transport)).rejects.toMatchObject({code:"MARKET_LIQUIDITY_UNAVAILABLE",message:"No liquidity available for this trade."});
  } finally { warning.mockRestore(); }
});

 it("quotes a USDC-sized buy as exact input and keeps the returned base quantity", async () => {
  const body = { side: "buy", quantity: "999", quoteAmount: "4.2" };
  const request = marketQuoteRequest(body, accountId, 0);
  expect(request).toMatchObject({ swapType: "EXACT_INPUT", amount: "4200000", originAsset: DEFAULT_PAIR.quote.assetId });
  const payload = quoteResponse(request, { amountIn: "4200000", amountInFormatted: "4.2", amountOut: "1000000000000000000000000", amountOutFormatted: "1", minAmountOut: "990000000000000000000000" });
  const preview = await previewMarket(body, balances, "jwt", async () => Response.json(payload), 0);
  expect(preview).toMatchObject({ side: "buy", quantity: "1", principal: "4.2", estimatedOutput: "1" });
  await expect(previewMarket(body, balances, "jwt", async () => Response.json({ ...payload, quote: { ...payload.quote, amountIn: "4300000", amountInFormatted: "4.3" } }), 0)).rejects.toThrow("does not match");
 });
 it("rejects invalid USDC spending amounts and quote-sized sells before contacting the provider", () => {
  for (const quoteAmount of ["0", "-1", "1.0000001", "1e2", null]) expect(() => marketQuoteRequest({ side: "buy", quoteAmount }, accountId)).toThrow();
  expect(() => marketQuoteRequest({ side: "sell", quantity: "1", quoteAmount: "1" }, accountId)).toThrow();
 });
