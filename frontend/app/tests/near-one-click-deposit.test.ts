// @vitest-environment node
import { depositQuote as responseSchema } from "@/lib/near/http/schemas/transfers";
import { describe, expect, it, vi } from "vitest";
import { ASSETS } from "@/lib/near/domain/assets";
import { createDepositQuote, readDepositStatus } from "../../../backend/id/src/near/services/one-click-deposit";

const accountId = "0x" + "a".repeat(40);
const wallet = "0x" + "b".repeat(40);
const bscUsdc = "nep141:bsc-usdc.omft.near";
const tokenFixture = [{ assetId: bscUsdc, blockchain: "bsc", symbol: "USDC", decimals: 18 }];

function quoteFixture(request: Record<string, unknown>, patch: Record<string, unknown> = {}) {
  return { correlationId: "deposit-1", timestamp: new Date(0).toISOString(), signature: "signed-quote", quoteRequest: request, quote: {
    depositAddress: "0x" + "c".repeat(40), amountIn: request.amount, amountInFormatted: "1",
    amountInUsd: "1", minAmountIn: request.amount, amountOut: "990000", amountOutFormatted: "0.99",
    amountOutUsd: "0.99", minAmountOut: "980000", deadline: new Date(1_800_000).toISOString(), timeEstimate: 30,
    ...patch,
  } };
}

describe("1Click BSC USDC deposits", () => {
  it("discovers the provider asset and binds an executable quote to the Intents account", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/v0/tokens")) return Response.json(tokenFixture);
      const request = JSON.parse(init?.body as string);
      expect(init?.headers).toMatchObject({ "X-API-Key": "jwt" });
      expect(request).toMatchObject({ dry: false, swapType: "EXACT_INPUT", originAsset: bscUsdc, destinationAsset: ASSETS[1].assetId, amount: "1000000000000000000", depositType: "ORIGIN_CHAIN", refundTo: wallet, refundType: "ORIGIN_CHAIN", recipient: accountId, recipientType: "INTENTS" });
      return Response.json(quoteFixture(request));
    });
    const quote = await createDepositQuote({ wallet, amount: "1" }, accountId, "jwt", fetcher, 0);
    expect(() => responseSchema.parse(JSON.parse(JSON.stringify(quote)))).not.toThrow();
    expect(quote).toMatchObject({ sourceChain: "BSC", asset: "USDC", depositAddress: "0x" + "c".repeat(40), amountInFormatted: "1", amountOutFormatted: "0.99", submissionEnabled: true });
  });

  it("fails closed without credentials or with a mismatched provider route", async () => {
    const fetcher = vi.fn();
    await expect(createDepositQuote({ wallet, amount: "1" }, accountId, "", fetcher)).rejects.toThrow("ONE_CLICK_JWT");
    expect(fetcher).not.toHaveBeenCalled();
    const mismatch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith("/v0/tokens") ? Response.json(tokenFixture) : Response.json(quoteFixture({ ...JSON.parse(init?.body as string), recipient: "0x" + "d".repeat(40) })));
    await expect(createDepositQuote({ wallet, amount: "1" }, accountId, "jwt", mismatch, 0)).rejects.toThrow("does not match");
  });

  it("reads only known statuses using the quoted deposit address", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("depositAddress=0x");
      expect(init?.headers).toMatchObject({ "X-API-Key": "jwt" });
      return Response.json({ status: "SUCCESS", updatedAt: new Date().toISOString() });
    });
    await expect(readDepositStatus({ depositAddress: "0x" + "c".repeat(40) }, "jwt", fetcher)).resolves.toMatchObject({ status: "SUCCESS", terminal: true });
    const withTransactions = async () => Response.json({ status: "SUCCESS", updatedAt: new Date().toISOString(), swapDetails: { originChainTxHashes: [{ hash: "0x" + "a".repeat(64), explorerUrl: "https://bscscan.com/tx/example" }], destinationChainTxHashes: [{ hash: "1".repeat(44), explorerUrl: "https://nearblocks.io/txns/example" }], nearTxHashes: ["2".repeat(44)] } });
    await expect(readDepositStatus({ depositAddress: "0x" + "c".repeat(40) }, "jwt", withTransactions)).resolves.toMatchObject({ originChainTxHashes: ["0x" + "a".repeat(64)], destinationChainTxHashes: ["1".repeat(44)], nearTxHashes: ["2".repeat(44)] });
    const opaqueFetcher = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("depositAddress=swap-account.near");
      return Response.json({ status: "SUCCESS", updatedAt: new Date().toISOString() });
    });
    await expect(readDepositStatus({ depositAddress: "swap-account.near" }, "jwt", opaqueFetcher)).resolves.toMatchObject({ status: "SUCCESS", terminal: true });
    await expect(readDepositStatus({ depositAddress: "bad identifier" }, "jwt", opaqueFetcher)).rejects.toThrow("Invalid 1Click deposit identifier");
    await expect(readDepositStatus({ depositAddress: "0x" + "c".repeat(40) }, "jwt", async () => Response.json({ status: "MYSTERY", updatedAt: new Date().toISOString() }))).rejects.toThrow("Unknown");
  });
});


it("returns the requested three-day refund deadline, not the later address expiry", async () => {
  const threeDays = new Date(3 * 24 * 60 * 60_000).toISOString();
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/v0/tokens")) return Response.json(tokenFixture);
    const request = JSON.parse(String(init?.body));
    expect(request.deadline).toBe(threeDays);
    return Response.json(quoteFixture(request, { deadline: new Date(6 * 24 * 60 * 60_000).toISOString() }));
  };
  const quote = await createDepositQuote({ wallet, amount: "1" }, accountId, "jwt", fetcher, 0);
  expect(quote.deadline).toBe(threeDays);
  expect(responseSchema.parse(quote)).toEqual(quote);
  const shortened = async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith("/v0/tokens")
    ? Response.json(tokenFixture)
    : Response.json(quoteFixture({ ...JSON.parse(String(init?.body)), deadline: new Date(1_800_000).toISOString() }));
  await expect(createDepositQuote({ wallet, amount: "1" }, accountId, "jwt", shortened, 0)).rejects.toThrow("does not match");
});

it("drops empty provider transaction hashes before persisting status", async () => {
  const status = await readDepositStatus({ depositAddress: "deposit.near" }, "jwt", async () => Response.json({
    status: "SUCCESS", updatedAt: new Date().toISOString(),
    swapDetails: { originChainTxHashes: [{ hash: "" }, { hash: "valid-origin" }], destinationChainTxHashes: [{ hash: "" }], nearTxHashes: ["", "valid-near"] },
  }));
  expect(status.originChainTxHashes).toEqual(["valid-origin"]);
  expect(status.destinationChainTxHashes).toEqual([]);
  expect(status.nearTxHashes).toEqual(["valid-near"]);
});

it("reports the credited amount only once a deposit succeeds", async () => {
  const read = (status: string) => readDepositStatus({ depositAddress: "deposit.near" }, "jwt", async () => Response.json({
    status, updatedAt: new Date().toISOString(), swapDetails: { depositedAmountFormatted: "5.0", amountOutFormatted: "4.9989" },
  }));
  expect((await read("SUCCESS")).creditedAmount).toBe("4.9989");
  expect((await read("PROCESSING")).creditedAmount).toBeUndefined();
  expect((await read("REFUNDED")).creditedAmount).toBeUndefined();
});

it("deposits SOL into SOL with its own decimals and preserves required memos", async () => {
  const sol = { assetId: "nep141:sol.omft.near", blockchain: "sol", symbol: "SOL", decimals: 9, coingeckoId: "solana" };
  const mock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/v0/tokens")) return Response.json([sol]);
    const request = JSON.parse(String(init?.body));
    expect(request).toMatchObject({ originAsset: sol.assetId, destinationAsset: sol.assetId, amount: "1000000000", recipient: accountId });
    return Response.json(quoteFixture(request, { depositAddress: "11111111111111111111111111111111", depositMemo: "required-memo", amountOut: "990000000", minAmountOut: "980000000" }));
  });
  const quote = await createDepositQuote({ wallet: "11111111111111111111111111111111", amount: "1", sourceAssetId: sol.assetId, targetAssetId: sol.assetId }, accountId, "jwt", mock, 0);
  expect(quote).toMatchObject({ asset: "SOL", sourceChain: "Solana", depositMemo: "required-memo", targetAssetId: sol.assetId });
  expect(responseSchema.safeParse(quote).success).toBe(true);
});
it("rejects a provider response whose formatted credit disagrees with token precision", async () => {
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith("/v0/tokens")
    ? Response.json(tokenFixture) : Response.json(quoteFixture(JSON.parse(String(init?.body)), { amountOutFormatted: "99" }));
  await expect(createDepositQuote({ wallet, amount: "1" }, accountId, "jwt", fetcher, 0)).rejects.toThrow("does not match");
});


it("reports an unavailable provider pair without retrying or exposing provider details", async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/v0/tokens")
    ? Response.json(tokenFixture)
    : Response.json({ message: "Quoting for this pair is not available", correlationId: "private-provider-id" }, { status: 400 }));
  await expect(createDepositQuote({}, accountId, "jwt", fetcher, 0, true, undefined, "0x" + "d".repeat(40))).rejects.toMatchObject({
    code: "DEPOSIT_NETWORK_UNAVAILABLE",
    message: "Deposits for this token and network are currently unavailable. Choose another network.",
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each(["SUCCESS", "PROCESSING", "FAILED"])("keeps actual execution amounts separate from quotes for %s", async status => {
  const result = await readDepositStatus({ depositAddress: "deposit.near" }, "jwt", async () => Response.json({
    status, updatedAt: "2026-10-19T00:00:00Z", quoteResponse: { quote: { amountInFormatted: "999", amountOutFormatted: "888" } },
    swapDetails: { amountIn: "1000000", amountOut: "2000000", amountInFormatted: "1", amountOutFormatted: "2" },
  }));
  expect(result.execution).toEqual(status === "SUCCESS" ? { inputRaw: "1000000", outputRaw: "2000000", inputAmount: "1", outputAmount: "2", settledAt: Date.parse("2026-10-19T00:00:00Z") } : undefined);
});

it.each([{ amountIn: '0' }, { amountOut: '-1' }, { amountInFormatted: 'NaN' }, { amountOut: '1'.repeat(79) }])('omits invalid settlement amounts without substituting a quote', async patch => {
  const result = await readDepositStatus({ depositAddress: 'deposit.near' }, 'jwt', async () => Response.json({
    status: 'SUCCESS', updatedAt: '2026-10-19T00:00:00Z',
    swapDetails: { amountIn: '1000000', amountOut: '2000000', amountInFormatted: '1', amountOutFormatted: '2', ...patch },
  }));
  expect(result.execution).toBeUndefined();
});

it("preserves an issued five-minute deadline when reading historical quote data", async () => {
  const fetcher: typeof fetch = async (url, init) => String(url).endsWith("/tokens") ? Response.json(tokenFixture) : Response.json(quoteFixture(JSON.parse(String(init?.body))));
  const quote = await createDepositQuote({ wallet, amount: "1" }, accountId, "synthetic", fetcher, 1000);
  expect(quote.deadline).toBe(new Date(1000 + 3 * 86400000).toISOString());
  const historical = { ...quote, deadline: new Date(301000).toISOString() };
  expect(responseSchema.parse(historical).deadline).toBe(historical.deadline);
});
