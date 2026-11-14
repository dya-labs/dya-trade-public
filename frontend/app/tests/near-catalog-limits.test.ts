import { privateAssetId, PRIVATE_VERIFIER, PRIVATE_SALT } from "@/lib/near/domain/confidential";
// @vitest-environment node
import { expect, it } from "vitest";
import { canonicalAssets } from "@/lib/near/domain/canonical-assets";
import { DEFAULT_PAIR, makePair } from "@/lib/near/domain/catalog";
import { previewLimit } from "@/lib/near/domain/limit-preview";
import { OneClickOrders, parseOrder } from "../../../backend/id/src/near/providers/one-click";
import { validateFunding } from "../../../backend/id/src/near/services/funding";
import { limitPreview } from "@/lib/near/http/schemas/trading";
import snapshot from "./fixtures/catalog-identities.json";
const accountId = "0x" + "a".repeat(40);

it.each(canonicalAssets(snapshot).map(asset => [asset.symbol, asset] as const))("binds %s buys and sells to their catalog asset through provider and funding validation (mock)", async (_, base) => {
  const pair = makePair(base, DEFAULT_PAIR.quote);
  const now = Date.now();
  const balances = { accountId, checkedAt: now, blockHeight: 1,
    assets: [pair.base, pair.quote].map(a => ({ ...a, raw: "0", amount: "0" })) };
  for (const side of ["buy", "sell"] as const) {
    const quantity = base.decimals ? `0.${"0".repeat(base.decimals - 1)}1` : "1";
    const preview = previewLimit({ side, quantity, price: "0.000001", expiryHours: 24 }, balances, now, pair);
    expect(preview.request.data.attributes.quantity).toBe("1");
    expect(limitPreview.parse(preview).pair).toEqual(pair);
    const inputAsset = side === "buy" ? pair.quote.assetId : pair.base.assetId;
    const outputAsset = side === "buy" ? pair.base.assetId : pair.quote.assetId;
    const response = { data: { type: "orders", id: "test-order", attributes: {
      ...preview.request.data.attributes, fillStatus: "AWAITING_DEPOSIT", payoutStatus: "NOT_STARTED",
      isPayoutStatusFinal: false, depositAddress: "deposit.near", depositedAmount: "0", partialFills: [],
      swapView: { swapType: side === "buy" ? "EXACT_OUTPUT" : "EXACT_INPUT", originAsset: inputAsset,
        destinationAsset: outputAsset, maxAmountIn: "1", amountIn: "1" },
    } } };
    const provider = await new OneClickOrders("mock", async (_url, init) => {
      expect(JSON.parse(String(init?.body)).data.attributes).toEqual(preview.request.data.attributes);
      return Response.json(response);
    }, true).create(preview, accountId);
    const order = { id: "local", ownerId: "owner", requestId: "request", terms: "", preview,
      state: "created" as const, createdAt: now, updatedAt: now, provider };
    const payload = { signer_id: accountId, verifying_contract: PRIVATE_VERIFIER, nonce: Buffer.concat([Buffer.from(`5628f6c600${PRIVATE_SALT}`, "hex"), Buffer.alloc(23, 1)]).toString("base64"),
      deadline: new Date(now + 60000).toISOString(), intents: [{ intent: "transfer", receiver_id: "deposit.near", tokens: { [privateAssetId(inputAsset)]: "1" } }] };
    const envelope = { intent: { standard: "webauthn", payload: JSON.stringify(payload) } };
    expect(validateFunding(envelope, order, now).assetId).toBe(inputAsset);
    expect(() => validateFunding(envelope, { ...order, provider: { ...provider, inputAsset: outputAsset } }, now)).toThrow();
    const binding = { accountId, side: side.toUpperCase() as "BUY" | "SELL", quantity: "1", price: "0.000001", baseAsset: base.assetId, quoteAsset: pair.quote.assetId };
    expect(() => parseOrder(response, { ...binding, baseAsset: "wrong-asset" })).toThrow();
    expect(() => previewLimit({ side, quantity: `${quantity}1`, price: "1", expiryHours: 24 }, balances, now, pair)).toThrow();
  }
});
