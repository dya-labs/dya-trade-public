import { expect, test, vi } from "vitest";
import { quoteSetupDelivery } from "../src/near/outlayer/setup-delivery";
import { TOKENS } from "../../../packages/wallet-contracts/src/domain/assets";
const now = 1_000_000;
const input = { asset: "USDC" as "USDC" | "NEAR", accountId: `0x${"a".repeat(40)}`, payer: "setup.near", outputYoctoNear: "60000000000000000000000" };
function fixture(change: (body: Record<string, any>) => void = () => {}, registered: unknown = { total: "1250000000000000000000" }) {
  const requests: Record<string, any>[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (String(url).includes('/v0/quote')) {
      const response = { timestamp: new Date(now).toISOString(), quoteRequest: body, quote: { amountIn: "250000", amountOut: input.outputYoctoNear, minAmountOut: input.outputYoctoNear, deadline: new Date(now + 60_000).toISOString() } };
      change(response);
      return Response.json(response);
    }
    return Response.json({ result: { result: [...Buffer.from(JSON.stringify(registered))] } });
  });
  // Unit-test boundary only. Production always defaults to the SDK's crypto check.
  const verify = vi.fn(() => true);
  return { fetcher, verify, requests };
}
test.each(["USDC", "NEAR"] as const)("collects a confidential %s exact-output dry route to native NEAR payer", async asset => {
  const f = fixture(); const route = await quoteSetupDelivery({ ...input, asset }, "synthetic-token", f.fetcher, now, f.verify);
  expect(route).toMatchObject({ destinationAssetId: TOKENS.wNEAR.assetId, outputYoctoNear: input.outputYoctoNear, expiresAt: now + 60_000, recipient: input.payer });
  expect(f.requests[0]).toMatchObject({ dry: true, swapType: "EXACT_OUTPUT", originAsset: asset === "USDC" ? TOKENS.USDC.assetId : TOKENS.wNEAR.assetId, depositType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS", recipientType: "DESTINATION_CHAIN", appFees: [] });
  expect(f.verify).toHaveBeenCalledOnce();
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});
test("requires no wNEAR receiver registration for native NEAR delivery", async () => {
  const f = fixture(undefined, null);
  await expect(quoteSetupDelivery(input, "synthetic-token", f.fetcher, now, f.verify)).resolves.toMatchObject({ outputYoctoNear: input.outputYoctoNear });
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0].recipientType).toBe("DESTINATION_CHAIN");
});
test.each(["recipient", "refundTo", "originAsset", "destinationAsset", "confidentiality", "amount"])("rejects changed %s", async field => {
  const f = fixture(body => { body.quoteRequest[field] = "changed"; });
  await expect(quoteSetupDelivery(input, "synthetic-token", f.fetcher, now, f.verify)).rejects.toThrow("match");
});
test("rejects hidden app fees, executable instructions and insufficient guaranteed output", async () => {
  for (const change of [
    (body: Record<string, any>) => { body.quoteRequest.appFees = [{ recipient: "other.near", fee: 100 }]; },
    (body: Record<string, any>) => { body.quote.depositAddress = "allocated.near"; },
    (body: Record<string, any>) => { body.quote.minAmountOut = "1"; },
    (body: Record<string, any>) => { body.quote.deadline = new Date(now + 1000).toISOString(); },
  ]) {
    const f = fixture(change);
    await expect(quoteSetupDelivery(input, "synthetic-token", f.fetcher, now, f.verify)).rejects.toThrow();
  }
});
test("rejects invalid or missing real quote signatures by default", async () => {
  const f = fixture();
  await expect(quoteSetupDelivery(input, "synthetic-token", f.fetcher, now)).rejects.toThrow("signature");
});
test("does no provider work when quote credentials are missing", async () => {
  const f = fixture();
  await expect(quoteSetupDelivery(input, "", f.fetcher, now)).rejects.toThrow("not configured");
  expect(f.fetcher).not.toHaveBeenCalled();
});
