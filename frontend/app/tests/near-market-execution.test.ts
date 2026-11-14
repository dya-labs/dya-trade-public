import { QuoteTimings } from "../../../backend/id/src/near/services/quote-timings";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import type { FeePlan } from "../../../packages/wallet-contracts/src/domain/trading-fees";
// @vitest-environment node
import { marketReview as responseSchema } from "@/lib/near/http/schemas/trading";
import { describe, expect, it, vi } from "vitest";
import { ASSETS, type LiveBalances } from "@/lib/near/domain/assets";
import { collectExecutableMarketQuote, prepareMarketSigningPayload, prepareExecutableMarketTrade, publishMarketIntent, validateExecutableMarketTrade } from "../../../backend/id/src/near/services/market-execution";
import type { SignedWebAuthn } from "../../../backend/id/src/near/auth/intents";

const accountId = "0x" + "a".repeat(40);
const depositAddress = "0x" + "bB".repeat(20);
const balances: LiveBalances = {
  accountId, blockHeight: 42, checkedAt: 0,
  assets: [
    { ...ASSETS[0], raw: "0", amount: "0" },
    { ...ASSETS[1], raw: "1000000", amount: "1" },
  ],
};

function quote(request: Record<string, unknown>, patch: Record<string, unknown> = {}) {
  return {
    correlationId: "quote-1", signature: "provider-signature", quoteRequest: request,
    quote: {
      amountIn: "452070", amountInFormatted: "0.45207",
      amountOut: "100000000000000000000000", amountOutFormatted: "0.1",
      minAmountOut: "99000000000000000000000", depositAddress,
      deadline: new Date(240_000).toISOString(), ...patch,
    },
  };
}
function generated(patch: Record<string, unknown> = {}) {
  return {
    correlationId: "intent-1",
    intent: {
      standard: "webauthn",
      payload: JSON.stringify({
        signer_id: accountId,
        verifying_contract: "intents.near",
        deadline: new Date(180_000).toISOString(),
        nonce: "nonce",
        intents: [{ intent: "token_diff", diff: {
          [ASSETS[1].assetId]: "-452070",
          [ASSETS[0].assetId]: "100000000000000000000000",
        } }],
      }),
      ...patch,
    },
  };
}

function fetcherFor(patch: Record<string, unknown> = {}, source = balances) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    if (String(url).endsWith("/quote")) {
      expect(request).toMatchObject({ dry: false, quoteWaitingTimeMs: 1000, slippageTolerance: 30, swapType: "EXACT_OUTPUT", depositType: "INTENTS", recipient: source.accountId });
      return Response.json(quote(request, patch));
    }
    expect(String(url)).toContain("/generate-intent");
    expect(request).toEqual({ type: "swap_transfer", standard: "webauthn", signerId: source.accountId, depositAddress });
    return Response.json(generated());
  });
}

describe("executable market buy", () => {
  it("rejects a forged provider signature before requesting a signing intent", async () => {
    const fetcher = fetcherFor();
    await expect(prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, balances, "jwt", fetcher, 0)).rejects.toThrow("signature is invalid");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("binds the quote to the exact provider-generated swap intent", async () => {
    const fetcher = fetcherFor();
    const review = await prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, balances, "jwt", fetcher, 0, () => true);
    expect(() => responseSchema.parse(JSON.parse(JSON.stringify(review)))).not.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(review).toMatchObject({ submissionEnabled: true, side: "buy", principal: "0.45207", minimumOutput: "0.099", slippageBps: 30, slippagePolicy: { mode: "default" }, depositAddress, correlationId: "intent-1" });
    expect(JSON.parse(review.payload).intents[0].intent).toBe("token_diff");
    expect(validateExecutableMarketTrade(review, accountId, 1)).toBe(review);
  });

  it("accepts an exact provider-generated transfer intent", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      if (String(url).endsWith("/quote")) return Response.json(quote(request));
      const response = generated();
      response.intent.payload = JSON.stringify({
        signer_id: accountId, verifying_contract: "intents.near",
        deadline: new Date(180_000).toISOString(), nonce: "nonce",
        intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [ASSETS[1].assetId]: "452070" } }],
      });
      return Response.json(response);
    });
    const review = await prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, balances, "jwt", fetcher, 0, () => true);
    expect(() => responseSchema.parse(JSON.parse(JSON.stringify(review)))).not.toThrow();
    expect(validateExecutableMarketTrade(review, accountId, 1)).toBe(review);
  });

  it("fails closed on insufficient funds, memos, and altered provider amounts", async () => {
    const poor = { ...balances, assets: [balances.assets[0], { ...balances.assets[1], raw: "1", amount: "0.000001" }] };
    await expect(prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, poor, "jwt", fetcherFor({}, poor), 0, () => true)).rejects.toThrow("Insufficient");
    await expect(prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, balances, "jwt", fetcherFor({ depositMemo: "memo" }), 0, () => true)).rejects.toThrow("Memo-based");
    const review = await prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, balances, "jwt", fetcherFor(), 0, () => true);
    expect(() => responseSchema.parse(JSON.parse(JSON.stringify(review)))).not.toThrow();
    const payload = JSON.parse(review.payload);
    payload.intents[0].diff[ASSETS[1].assetId] = "-1";
    expect(() => validateExecutableMarketTrade({ ...review, payload: JSON.stringify(payload) }, accountId, 1)).toThrow();
  });

  it("submits the signed data through 1Click and validates the returned hash", async () => {
    const signed = { standard: "webauthn", payload: "{}", public_key: "p256:key", signature: "p256:sig", client_data_json: "{}", authenticator_data: "data" } satisfies SignedWebAuthn;
    const result = await publishMarketIntent(signed, "jwt", async (url, init) => {
      expect(String(url)).toContain("/submit-intent");
      expect(new Headers(init?.headers).get("X-API-Key")).toBe("jwt");
      expect(JSON.parse(String(init?.body))).toEqual({ type: "swap_transfer", signedData: signed });
      return Response.json({ intentHash: "4".repeat(44), correlationId: "submit-1" });
    });
    expect(result.intentHash).toBe("4".repeat(44));
  });
});


describe("executable market sell", () => {
  const sellBalances: LiveBalances = { ...balances, assets: [
    { ...ASSETS[0], raw: "200000000000000000000000", amount: "0.2" },
    balances.assets[1],
  ] };
  function sellFetcher(intent: "transfer" | "token_diff" = "transfer", patch: Record<string, unknown> = {}) {
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      if (String(url).endsWith("/quote")) {
        expect(request).toMatchObject({ dry: false, swapType: "EXACT_INPUT", originAsset: ASSETS[0].assetId, destinationAsset: ASSETS[1].assetId, amount: "100000000000000000000000", depositType: "INTENTS", recipient: accountId });
        return Response.json({ quoteRequest: request, quote: { amountIn: "100000000000000000000000", amountInFormatted: "0.1", amountOut: "420000", amountOutFormatted: "0.42", minAmountOut: "415000", depositAddress, deadline: new Date(240_000).toISOString(), ...patch } });
      }
      expect(request).toEqual({ type: "swap_transfer", standard: "webauthn", signerId: accountId, depositAddress });
      return Response.json({ correlationId: "sell-intent", intent: { standard: "webauthn", payload: JSON.stringify({ signer_id: accountId, verifying_contract: "intents.near", deadline: new Date(180_000).toISOString(), nonce: "nonce", intents: [intent === "transfer" ? { intent: "transfer", receiver_id: depositAddress, tokens: { [ASSETS[0].assetId]: "100000000000000000000000" } } : { intent: "token_diff", diff: { [ASSETS[0].assetId]: "-100000000000000000000000", [ASSETS[1].assetId]: "420000" } }] }) } });
    });
  }
  it("quotes an exact-input wNEAR sale and binds the signing payload", async () => {
    for (const intent of ["transfer", "token_diff"] as const) {
      const fetcher = sellFetcher(intent);
      const review = await prepareExecutableMarketTrade({ side: "sell", quantity: "0.1" }, sellBalances, "jwt", fetcher, 0, () => true);
    expect(() => responseSchema.parse(JSON.parse(JSON.stringify(review)))).not.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(review).toMatchObject({ side: "sell", inputSymbol: "wNEAR", outputSymbol: "USDC", principal: "0.1", estimatedOutput: "0.42", minimumOutput: "0.415", inputRaw: "100000000000000000000000", outputRaw: "420000" });
      expect(validateExecutableMarketTrade(review, accountId, 1)).toBe(review);
      const changed = JSON.parse(review.payload);
      if (intent === "transfer") changed.intents[0].tokens[ASSETS[0].assetId] = "1";
      else changed.intents[0].diff[ASSETS[1].assetId] = "1";
      expect(() => validateExecutableMarketTrade({ ...review, payload: JSON.stringify(changed) }, accountId, 1)).toThrow();
    }
  });
  it("rejects overselling and quote size or minimum changes", async () => {
    await expect(prepareExecutableMarketTrade({ side: "sell", quantity: "1" }, sellBalances, "jwt", sellFetcher(), 0, () => true)).rejects.toThrow("Insufficient");
    await expect(prepareExecutableMarketTrade({ side: "sell", quantity: "0.1" }, sellBalances, "jwt", sellFetcher("transfer", { amountIn: "1" }), 0, () => true)).rejects.toThrow();
    await expect(prepareExecutableMarketTrade({ side: "sell", quantity: "0.1" }, sellBalances, "jwt", sellFetcher("transfer", { minAmountOut: "500000" }), 0, () => true)).rejects.toThrow();
  });
});

it("uses and returns custom tolerance without automatic adjustment", async () => {
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    if (String(url).endsWith("/quote")) {
      expect(request.slippageTolerance).toBe(25);
      return Response.json(quote(request));
    }
    return Response.json(generated());
  });
  const review = await prepareExecutableMarketTrade({ side: "buy", quantity: "0.1", slippage: { mode: "custom", bps: 25 } }, balances, "jwt", fetcher, 0, () => true);
  expect(review.slippageBps).toBe(25);
  expect(review.slippagePolicy).toEqual({ mode: "custom" });
  expect(responseSchema.parse(review).slippagePolicy).toEqual({ mode: "custom" });
});
it("rejects invalid custom tolerance before calling the provider", async () => {
  const fetcher = vi.fn();
  await expect(prepareExecutableMarketTrade({ side: "buy", quantity: "0.1", slippage: { mode: "custom", bps: 501 } }, balances, "jwt", fetcher, 0, () => true)).rejects.toThrow("Invalid request");
  expect(fetcher).not.toHaveBeenCalled();
});

// Hypothetical test terms only; these do not change the stored fee policy or activate fees.
it("wires fee allocations into executable quotes and rejects excess before generate-intent", async () => {
  const plan: FeePlan = {kind:"market", revision:1, maxTotalBps:25, recipient:"treasury.near", requestedDyaBps:5};
  for (const providerBps of [20,21]) {
    const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const request=JSON.parse(String(init?.body));
      if(String(url).endsWith("/quote")) {
        expect(request.appFees).toEqual([{recipient:plan.recipient,fee:5}]);
        expect(request.quoteWaitingTimeMs).toBe(1000);
        const response=quote(request,{refundFee:"0",withdrawFee:"0"});
        expect(request.dry).toBe(false);
        response.quoteRequest={...request,appFees:[...request.appFees,{recipient:"provider.near",fee:providerBps}]};
        return Response.json(response);
      }
      return Response.json(generated());
    });
    const prepared=prepareExecutableMarketTrade({side:"buy",quantity:"0.1"},balances,"synthetic",transport,0,()=>true,DEFAULT_PAIR,false,plan);
    if(providerBps===20) {
      const review=await prepared;
      expect(review.feeReceipt).toMatchObject({plan,totalBps:25});
      expect(responseSchema.parse(review).feeReceipt?.totalBps).toBe(25);
      expect(transport).toHaveBeenCalledTimes(2);
      expect(()=>validateExecutableMarketTrade({...review,feeReceipt:{...review.feeReceipt!,totalBps:5}},accountId,1)).toThrow();
    } else {
      await expect(prepared).rejects.toThrow("fee allocation");
      expect(transport).toHaveBeenCalledTimes(1);
    }
  }
});

it.each([400, 401, 403, 503])("classifies executable quote HTTP %s before requesting a signing payload", async status => {
  const plan: FeePlan = { kind: "market", revision: 1, maxTotalBps: 25, recipient: "treasury.near", requestedDyaBps: 5 };
  const transport = vi.fn(async () => new Response("private provider failure", { status }));
  await expect(prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, balances, "synthetic", transport, 0, () => true, DEFAULT_PAIR, false, plan))
    .rejects.toMatchObject({ code: status === 401 || status === 403 ? "ONE_CLICK_EXECUTION_CREDENTIALS_WERE_REJECTED" : "EXECUTABLE_MARKET_QUOTE_UNAVAILABLE" });
  expect(transport).toHaveBeenCalledOnce();
});

it("logs a sanitized executable quote rejection and reports missing liquidity as such", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const transport = vi.fn(async () => Response.json({ message: "No liquidity available", correlationId: "749933b8-980c-42bf-b541-63a08fd3d82d", request: { refundTo: balances.accountId } }, { status: 400 }));
  try {
    await expect(prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, balances, "synthetic-credential", transport, 0, () => true, DEFAULT_PAIR, true))
      .rejects.toMatchObject({ code: "MARKET_LIQUIDITY_UNAVAILABLE" });
    expect(warning).toHaveBeenCalledWith("trading.quote.executable_rejected", { status: 400, providerCode: undefined, reason: "No liquidity available", correlationId: "749933b8-980c-42bf-b541-63a08fd3d82d" });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(balances.accountId);
  } finally { warning.mockRestore(); }
});

it.each(["signature", "recipient", "confidentiality", "amount", "expiry"])("rejects an executable quote with invalid %s before signing-payload generation", async fault => {
  const plan: FeePlan = { kind: "market", revision: 1, maxTotalBps: 25, recipient: "treasury.near", requestedDyaBps: 5 };
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    expect(request.dry).toBe(false);
    const response = quote(request, { refundFee: "0", withdrawFee: "0" });
    response.quoteRequest = { ...request, appFees: [...request.appFees, { recipient: "provider.near", fee: 20 }] };
    if (fault === "recipient") response.quoteRequest.recipient = "0x" + "b".repeat(40);
    if (fault === "confidentiality") response.quoteRequest.confidentiality = "public";
    if (fault === "amount") response.quote.amountInFormatted = "0.5";
    if (fault === "expiry") response.quote.deadline = new Date(1000).toISOString();
    return Response.json(response);
  });
  await expect(prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, balances, "synthetic", transport, 0, () => fault !== "signature", DEFAULT_PAIR, true, plan)).rejects.toThrow();
  expect(transport).toHaveBeenCalledOnce();
});

 it("prepares an exact-spend buy and binds the actual received quantity to the signed review", async () => {
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    if (String(url).endsWith("/quote")) {
      expect(request).toMatchObject({ swapType: "EXACT_INPUT", amount: "452070" });
      return Response.json(quote(request));
    }
    return Response.json(generated());
  });
  const review = await prepareExecutableMarketTrade({ side: "buy", quantity: "999", quoteAmount: "0.45207" }, balances, "jwt", transport, 0, () => true);
  expect(review).toMatchObject({ side: "buy", quantity: "0.1", principal: "0.45207", inputRaw: "452070" });
  expect(validateExecutableMarketTrade(review, accountId, 1)).toBe(review);
  const changedInput = async (_url: unknown, init?: RequestInit) => Response.json(quote(JSON.parse(String(init?.body)), { amountIn: "452071", amountInFormatted: "0.452071" }));
  await expect(prepareExecutableMarketTrade({ side: "buy", quoteAmount: "0.45207" }, balances, "jwt", changedInput, 0, () => true)).rejects.toThrow("changed the requested market size");
 });

it("requests only an executable quote and signing payload, with separate timings", async () => {
  const plan: FeePlan = { kind: "market", revision: 1, maxTotalBps: 25, recipient: "treasury.near", requestedDyaBps: 5 };
  let elapsed = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  try {
    const timings = new QuoteTimings("prepare");
    const steps: string[] = [];
    const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      if (!String(url).endsWith("/quote")) { steps.push("signing_payload"); elapsed += 50; return Response.json(generated()); }
      expect(request.dry).toBe(false);
      steps.push("executable");
      elapsed += request.quoteWaitingTimeMs;
      const response = quote(request, { refundFee: "0", withdrawFee: "0" });
      response.quoteRequest = { ...request, appFees: [...request.appFees, { recipient: "provider.near", fee: 20 }] };
      return Response.json(response);
    });
    const review = await prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, balances, "synthetic", transport, 0, () => true, DEFAULT_PAIR, false, plan, timings);
    expect(steps).toEqual(["executable", "signing_payload"]);
    expect(timings.snapshot()).toEqual({ executable: 1000, signing_payload: 50, total: 1050 });
    expect(review.feeReceipt?.totalBps).toBe(25);
    expect(validateExecutableMarketTrade(review, accountId, 1)).toBe(review);
  } finally { clock.mockRestore(); }
});

it("overlaps fresh balances with quoting and waits for the balance before requesting a signing payload", async () => {
  let resolveBalances!: (value: LiveBalances) => void;
  const load = vi.fn(() => new Promise<LiveBalances>(resolve => { resolveBalances = resolve; }));
  const transport = fetcherFor();
  const pending = prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, { accountId, load }, "synthetic", transport, 0, () => true);
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  expect(transport).toHaveBeenCalledTimes(1);
  expect(String(transport.mock.calls[0][0])).toContain("/quote");
  resolveBalances(balances);
  const review = await pending;
  expect(transport).toHaveBeenCalledTimes(2);
  expect(review.balanceBlock).toBe(balances.blockHeight);
});

it.each(["unavailable", "insufficient", "different-account"])("blocks signing payloads when the parallel balance is %s", async fault => {
  const load = vi.fn(async () => {
    if (fault === "unavailable") throw new Error("Balance service unavailable");
    if (fault === "different-account") return { ...balances, accountId: "0x" + "b".repeat(40) };
    return { ...balances, assets: balances.assets.map(asset => ({ ...asset, raw: "0", amount: "0" })) };
  });
  const transport = fetcherFor();
  await expect(prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, { accountId, load }, "synthetic", transport, 0, () => true)).rejects.toThrow();
  expect(load).toHaveBeenCalledOnce();
  expect(transport).toHaveBeenCalledOnce();
});

it("handles an early balance failure even when the quote subsequently fails validation", async () => {
  let resolveQuote!: (value: Response) => void;
  const transport = vi.fn(() => new Promise<Response>(resolve => { resolveQuote = resolve; }));
  const load = vi.fn(async () => { throw new Error("Balance read failed"); });
  const pending = prepareExecutableMarketTrade({ side: "buy", quantity: "0.1" }, { accountId, load }, "synthetic", transport, 0, () => false);
  const rejected = expect(pending).rejects.toThrow("signature is invalid");
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  resolveQuote(Response.json(quote({})));
  await rejected;
  expect(transport).toHaveBeenCalledOnce();
});

it("collects background executable quotes for three seconds without generating a signing payload", async () => {
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    expect(request).toMatchObject({ dry: false, quoteWaitingTimeMs: 3000 });
    return Response.json(quote(request));
  });
  const collected = await collectExecutableMarketQuote({ side: "buy", quantity: "0.1" }, balances, "jwt", transport, 0, () => true, DEFAULT_PAIR, false, undefined, undefined, { quoteWaitingTimeMs: 3000 });
  expect(transport).toHaveBeenCalledOnce();
  expect(collected).toMatchObject({ principal: "0.45207", swapType: "EXACT_OUTPUT" });
  expect(collected).not.toHaveProperty("payload");
  const signingTransport = fetcherFor();
  const review = await prepareMarketSigningPayload(collected, accountId, "jwt", signingTransport, 0);
  expect(signingTransport).toHaveBeenCalledOnce();
  expect(String(signingTransport.mock.calls[0][0])).toContain("/generate-intent");
  expect(validateExecutableMarketTrade(review, accountId, 1)).toBe(review);
});
it("can show an unaffordable executable quote without making it reusable or signable", async () => {
  const empty = { ...balances, assets: balances.assets.map(asset => ({ ...asset, raw: "0", amount: "0" })) };
  const transport = fetcherFor({}, empty);
  const collected = await collectExecutableMarketQuote({ side: "buy", quantity: "0.1" }, empty, "jwt", transport, 0, () => true, DEFAULT_PAIR, false, undefined, undefined, { allowShortfall: true });
  expect(collected.shortfall).toBe("0.45207");
  expect(transport).toHaveBeenCalledOnce();
  const signing = vi.fn();
  await expect(prepareMarketSigningPayload(collected, accountId, "jwt", signing, 0)).rejects.toThrow("Insufficient");
  expect(signing).not.toHaveBeenCalled();
});
