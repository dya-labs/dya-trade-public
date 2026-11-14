import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { request } from "@/lib/near/http/request";
import { ErrorCode } from "@/lib/near/domain/errors";
import { snapshot, authenticationOptions, registrationOptions } from "@/lib/near/http/schemas/account";
import { generateAuthenticationOptions, generateRegistrationOptions } from "@simplewebauthn/server";

afterEach(() => vi.unstubAllGlobals());
it("validates successful responses and forwards cancellation and JSON bodies", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ count: 2, extra: true }));
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  expect(await request("example", z.object({ count: z.number() }), { id: "a" }, signal)).toEqual({ count: 2 });
  expect(fetcher).toHaveBeenCalledWith("/api/near/example", expect.objectContaining({ method: "POST", body: '{"id":"a"}', signal, cache: "no-store" }));
});
it.each([null, {}, { account: null, passkeyOrigin: 123 }, { account: { id: "a", kind: "wallet" }, passkeyOrigin: "https://example.com" }])("rejects malformed session data: %j", async data => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
  await expect(request("state", snapshot)).rejects.toMatchObject({ code: ErrorCode.InvalidApiResponse });
});
it("accepts a signed-out session", async () => {
  const data = { account: null, passkeyOrigin: "http://localhost:3100" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
  expect(await request("state", snapshot)).toEqual(data);
});
it.each([new Response("<html>Gateway error</html>", { status: 502 }), Response.json({ error: { secret: "hidden" } }, { status: 400 })])("handles non-JSON and malformed errors safely", async response => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  await expect(request("state", snapshot)).rejects.toThrow("Request failed");
});
it("preserves server messages and never retries mutations", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "Check order status" }, { status: 400 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(request("submit", z.object({ ok: z.literal(true) }), {})).rejects.toThrow("Check order status");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects HTML with a successful HTTP status", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Sign in</html>")));
  await expect(request("state", snapshot)).rejects.toMatchObject({ code: ErrorCode.InvalidApiResponse });
});
it("preserves abort errors", async () => {
  const error = new DOMException("Aborted", "AbortError");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
  await expect(request("state", snapshot)).rejects.toBe(error);
});
it("accepts real library-generated WebAuthn options without dropping active settings", async () => {
  const registration = await generateRegistrationOptions({ rpName: "Terminal", rpID: "localhost", userName: "tester", supportedAlgorithmIDs: [-7], authenticatorSelection: { residentKey: "required", userVerification: "required" } });
  const authentication = await generateAuthenticationOptions({ rpID: "localhost", userVerification: "required", allowCredentials: [{ id: "credential", transports: ["internal"] }] });
  expect(registrationOptions.parse(registration)).toEqual(registration);
  expect(authenticationOptions.parse(authentication)).toEqual(authentication);
});

it("validates nested financial fields through the named endpoint service", async () => {
  const { previewMarketOrder } = await import("@/lib/near/http/trading-client");
  const quote = { orderType: "market", submissionEnabled: false, side: "buy", quantity: "1", inputSymbol: "USDC", outputSymbol: "wNEAR", principal: "4", estimatedOutput: "1", minimumOutput: "0.99", available: "10", shortfall: "0", balanceBlock: 123, slippageBps: 100, expiresAt: "2026-09-24T00:00:00+00:00", timeEstimateSeconds: null };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(quote)).mockResolvedValueOnce(Response.json({ ...quote, principal: 4 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await previewMarketOrder({ side: "buy", quantity: "1" })).toEqual(quote);
  expect(fetcher).toHaveBeenCalledWith("/api/near/live/preview", expect.objectContaining({ body: JSON.stringify({ side: "buy", quantity: "1", orderType: "market", reusable: true }) }));
  await expect(previewMarketOrder({ side: "buy", quantity: "1" })).rejects.toMatchObject({ code: ErrorCode.InvalidApiResponse });
});

it("rejects unknown operation states before returning activity to the UI", async () => {
  const { getMarketTrades } = await import("@/lib/near/http/trading-client");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ trades: [{ id: "trade", state: "new-provider-state" }] })));
  await expect(getMarketTrades()).rejects.toMatchObject({ code: ErrorCode.InvalidApiResponse });
});


it("accepts legacy trade history without weakening executable quote validation", async () => {
  const { trade, marketReview } = await import("@/lib/near/http/schemas/trading");
  const review = { orderType: "market", submissionEnabled: true, side: "buy", quantity: "1", inputSymbol: "USDC", outputSymbol: "wNEAR", principal: "4", estimatedOutput: "1", minimumOutput: "0.99", available: "10", shortfall: "0", balanceBlock: 123, slippageBps: 100, expiresAt: "2026-09-24T00:00:00Z", depositAddress: "deposit.near", depositMemo: null, correlationId: "quote-1" };
  const legacy = { id: "old-trade", createdAt: 1, updatedAt: 2, state: "settled", review };
  for (const state of ["signing", "submitted", "unknown", "settled", "failed"])
    expect(trade.parse({ ...legacy, state }).review).toEqual(review);
  expect(marketReview.safeParse(review).success).toBe(false);
  expect(trade.safeParse({ ...legacy, review: { ...review, inputRaw: "invalid" } }).success).toBe(false);
  const { getMarketTrades } = await import("@/lib/near/http/trading-client");
  const recent = { ...legacy, id: "new-trade", review: { ...review, inputRaw: "4000000", outputRaw: "1000000000000000000000000" } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ trades: [legacy, recent] })));
  expect((await getMarketTrades()).trades).toHaveLength(2);
});


it("accepts legacy withdrawal history without weakening new withdrawal validation", async () => {
  const { withdrawalReview, withdrawal } = await import("@/lib/near/http/schemas/transfers");
  const review = { direction: "withdraw", sourceChain: "NEAR Intents", destinationChain: "BNB Smart Chain", asset: "USDC", amount: "1", amountRaw: "1000000", destinationWallet: "0x" + "a".repeat(40), destinationAsset: "bsc-usdc", expectedReceive: "0.99", minimumReceive: "0.98", available: "10", balanceBlock: 123, deadline: "2026-09-24T00:00:00Z", depositAddress: "deposit.near", depositMemo: null, correlationId: "withdrawal-1" };
  const legacy = { id: "old-withdrawal", createdAt: 1, state: "settled", review };
  for (const state of ["signing", "submitted", "unknown", "settled", "failed"])
    expect(withdrawal.parse({ ...legacy, state }).review).toEqual(review);
  expect(withdrawalReview.safeParse(review).success).toBe(false);
  expect(withdrawal.safeParse({ ...legacy, review: { ...review, originAsset: 123 } }).success).toBe(false);
  const { getWithdrawals } = await import("@dya/wallet-ui/lib/near/http/transfers-client");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ withdrawals: [legacy, { ...legacy, id: "recent", review: { ...review, originAsset: "nep141:usdc" } }] })));
  expect((await getWithdrawals()).withdrawals).toHaveLength(2);
});
