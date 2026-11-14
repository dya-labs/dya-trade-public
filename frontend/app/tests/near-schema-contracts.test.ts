// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { snapshot, balances } from "@/lib/near/http/schemas/account";
import { depositStatus } from "@/lib/near/http/schemas/common";
import { readDepositStatus } from "../../../backend/id/src/near/services/one-click-deposit";
import { readBalances } from "../../../backend/id/src/near/providers/live";
import { getOrders, getMarketTrades } from "@/lib/near/http/trading-client";
import { getDeposits, getWithdrawals } from "@dya/wallet-ui/lib/near/http/transfers-client";

afterEach(() => vi.unstubAllGlobals());
const wire = (value: unknown) => JSON.parse(JSON.stringify(value));
it("preserves exact 24-decimal balance strings from the RPC producer", async () => {
  const amounts = ["1000000000000000000000001", "0"];
  const result = await readBalances("0x" + "a".repeat(40), async () => Response.json({ result: { block_height: 123, result: [...Buffer.from(JSON.stringify(amounts))] } }));
  expect(balances.parse(wire(result))).toEqual(result);
});
it.each(["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"])("accepts provider status %s", async status => {
  const result = await readDepositStatus({ depositAddress: "deposit.near" }, "jwt", async () => Response.json({ status, updatedAt: new Date().toISOString() }));
  expect(depositStatus.parse(result.status)).toBe(status);
});
it.each([undefined, null])("accepts absent or null optional account metadata (%s)", metadata => {
  const result = snapshot.parse(wire({ passkeyOrigin: "http://localhost:3100", account: { id: "account", kind: "passkey", intentsIdentity: metadata, backup: metadata, signingCheck: metadata } }));
  expect(result.account?.id).toBe("account");
});
it("accepts empty activity lists through every named history service", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ orders: [] })).mockResolvedValueOnce(Response.json({ trades: [] })).mockResolvedValueOnce(Response.json({ deposits: [] })).mockResolvedValueOnce(Response.json({ withdrawals: [] }));
  vi.stubGlobal("fetch", fetcher);
  expect(await getOrders()).toEqual({ orders: [] });
  expect(await getMarketTrades()).toEqual({ trades: [] });
  expect(await getDeposits()).toEqual({ deposits: [] });
  expect(await getWithdrawals()).toEqual({ withdrawals: [] });
});
it("accepts order lifecycle and provider fill states with a server-generated preview", async () => {
  const { previewLimit } = await import("@/lib/near/domain/limit-preview");
  const { ASSETS } = await import("@/lib/near/domain/assets");
  const { order, executableLimitReview } = await import("@/lib/near/http/schemas/trading");
  const preview = previewLimit({ side: "buy", quantity: "1", price: "4", expiryHours: 24 }, { accountId: "account", blockHeight: 123, checkedAt: 1, assets: ASSETS.map(asset => ({ ...asset, raw: "0", amount: "0" })) }, 0);
  const base = { id: "order", ownerId: "account", requestId: "request", terms: JSON.stringify(preview.request), preview, createdAt: 1, updatedAt: 2 };
  for (const state of ["creating", "created", "failed", "unknown"]) expect(order.parse(wire({ ...base, state })).state).toBe(state);
  for (const fillStatus of ["AWAITING_DEPOSIT", "OPEN", "PARTIALLY_FILLED", "FILLED", "PENDING_CANCEL", "CANCELED", "EXPIRED", "UNTRIGGERED"]) {
    const provider = { id: "provider", fillStatus, payoutStatus: "PENDING", payoutFinal: false, depositAddress: "deposit.near", fundingAmount: "4000000", inputAsset: ASSETS[1].assetId, depositedAmount: "0", partialFills: [] };
    expect(order.parse(wire({ ...base, state: "created", provider })).provider?.fillStatus).toBe(fillStatus);
  }
  const executable = { ...preview, submissionEnabled: true, orderId: "order", fundingAmount: "4" };
  expect(executableLimitReview.parse({ ...executable, fundingExpiresAt: new Date(60_000).toISOString() }).submissionEnabled).toBe(true);
  expect(executableLimitReview.safeParse(executable).success).toBe(true);
  expect(executableLimitReview.safeParse({ ...executable, fundingExpiresAt: "unknown" }).success).toBe(false);
  expect(executableLimitReview.safeParse(preview).success).toBe(false);
});
