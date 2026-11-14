import type { FeePlan } from "../../../packages/wallet-contracts/src/domain/trading-fees";
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ASSETS } from "@/lib/near/domain/assets";
import { previewLimit } from "@/lib/near/domain/limit-preview";
import { OneClickOrders, parseOrder, ProviderError } from "../../../backend/id/src/near/providers/one-click";
const accountId = "0x" + "a".repeat(40);
const preview = previewLimit({ side: "buy", quantity: "1", price: "4", expiryHours: 24 }, {
  accountId, blockHeight: 1, checkedAt: Date.now(),
  assets: ASSETS.map(a => ({ ...a, amount: "0", raw: "0" })),
});
const binding = { id: "order-1", accountId, side: "BUY" as const, quantity: preview.request.data.attributes.quantity, price: "4" };
function fixture(patch: Record<string, unknown> = {}) {
  return { data: { type: "orders", id: binding.id, attributes: {
    ...preview.request.data.attributes, fillStatus: "AWAITING_DEPOSIT",
    payoutStatus: "NOT_STARTED", isPayoutStatusFinal: false,
    depositAddress: "deposit.near", depositedAmount: "0", partialFills: [],
    swapView: { swapType: "EXACT_OUTPUT", originAsset: ASSETS[1].assetId, destinationAsset: ASSETS[0].assetId, maxAmountIn: "4010000" },
    ...patch,
  } } };
}
describe("1Click order adapter (mock transport only)", () => {
  it("blocks mutations by default, including when credentials exist", async () => {
    const fetcher = vi.fn();
    const client = new OneClickOrders("test-key", fetcher);
    await expect(client.create(preview, accountId)).rejects.toThrow("disabled");
    await expect(client.cancel(binding)).rejects.toThrow("disabled");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires credentials before reading", async () => {
    const fetcher = vi.fn();
    await expect(new OneClickOrders("", fetcher).get(binding)).rejects.toThrow("not configured");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends fixed provider URL and binds request recipients; uses provider funding amount", async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      expect(JSON.parse(init?.body as string).data.attributes.recipient).toBe(accountId);
      return Response.json(fixture(), { status: 201 });
    });
    const order = await new OneClickOrders("test-key", fetcher, true).create(preview, accountId);
    expect(fetcher.mock.calls[0][0]).toBe("https://1click.chaindefuser.com/v0/orders");
    expect(order.fundingAmount).toBe("4010000");
    expect(order.payoutFinal).toBe(false);
  });
  it("creates a limit sell funded with wNEAR and validates the provider asset", async () => {
    const sell = previewLimit({ side: "sell", quantity: "0.1", price: "4", expiryHours: 24 }, {
      accountId, blockHeight: 1, checkedAt: Date.now(), assets: ASSETS.map(a => ({ ...a, amount: "0", raw: "0" })),
    });
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const attributes = JSON.parse(String(init?.body)).data.attributes;
      expect(attributes).toMatchObject({ side: "SELL", quantity: "100000000000000000000000", recipient: accountId, depositType: "CONFIDENTIAL_INTENTS" });
      return Response.json({ data: { type: "orders", id: "sell-1", attributes: {
        ...attributes, fillStatus: "AWAITING_DEPOSIT", payoutStatus: "NOT_STARTED", isPayoutStatusFinal: false,
        depositAddress: "deposit.near", depositedAmount: "0", partialFills: [],
        swapView: { swapType: "EXACT_INPUT", originAsset: ASSETS[0].assetId, destinationAsset: ASSETS[1].assetId, amountIn: "100000000000000000000000" },
      } } }, { status: 201 });
    });
    const order = await new OneClickOrders("test-key", fetcher, true).create(sell, accountId);
    expect(order).toMatchObject({ fundingAmount: "100000000000000000000000", inputAsset: ASSETS[0].assetId });
  });
  it("recovers a successful create from an abbreviated response using authoritative GET", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: { type: "orders", id: binding.id, attributes: {} } }, { status: 201 }))
      .mockResolvedValueOnce(Response.json(fixture()));
    const order = await new OneClickOrders("test-key", fetcher, true).create(preview, accountId);
    expect(order.id).toBe(binding.id);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe("https://1click.chaindefuser.com/v0/orders/order-1");
  });
  it("reconciles one recent order with exact account and terms", async () => {
    const recent = fixture({ createdAt: new Date().toISOString() }).data;
    const client = new OneClickOrders("test-key", async () => Response.json({ data: [recent] }));
    await expect(client.find({ ...binding, id: undefined }, Date.now())).resolves.toMatchObject({ id: binding.id, fillStatus: "AWAITING_DEPOSIT" });
  });
  it("rejects account, pair, terms, funding and unknown-state mismatches", () => {
    for (const patch of [
      { confidentiality: "basic" }, { confidentiality: "public" }, { depositType: "INTENTS" }, { refundType: "INTENTS" }, { recipientType: "INTENTS" },
      { recipient: "attacker.near" }, { refundTo: "attacker.near" },
      { baseAsset: "other" }, { quantity: "2" }, { price: "5" },
      { fillStatus: "NEW_STATE" }, { isPayoutStatusFinal: "true" },
      { isPayoutStatusFinal: true }, { swapView: {} },
      { depositedAmount: 0 },
      { partialFills: [{ id: "1", amountIn: "1", amountOut: "1" }, { id: "1", amountIn: "1", amountOut: "1" }] },
    ]) expect(() => parseOrder(fixture(patch), binding)).toThrow();
  });
  it("does not confuse fully matched with settled, or pending cancel with canceled", () => {
    expect(parseOrder(fixture({ fillStatus: "FILLED" }), binding).payoutFinal).toBe(false);
    expect(parseOrder(fixture({ fillStatus: "PENDING_CANCEL" }), binding).fillStatus).toBe("PENDING_CANCEL");
    expect(parseOrder(fixture({ fillStatus: "FILLED", payoutStatus: "COMPLETED", isPayoutStatusFinal: true }), binding).payoutFinal).toBe(true);
  });
  it("retains completed payout and refund transaction hashes separately from fill IDs", () => {
    const hash1 = "A".repeat(44), hash2 = "B".repeat(44), refund = "C".repeat(44);
    const parsed = parseOrder(fixture({ payouts: {
      withdrawal: { status: "COMPLETED", txHash: hash2 },
      allWithdrawals: [{ status: "COMPLETED", txHash: hash1 }, { status: "COMPLETED", txHash: hash2 }],
      refund: { status: "COMPLETED", txHash: refund },
    }, partialFills: [{ id: "fill-1", amountIn: "1", amountOut: "1" }] }), binding);
    expect(parsed.payoutTxHashes).toEqual([hash1, hash2]);
    expect(parsed.refundTxHash).toBe(refund);
    expect(parsed.partialFills[0].id).toBe("fill-1");
  });
  it("rejects a completed payout without its transaction hash", () => {
    expect(() => parseOrder(fixture({ payouts: {
      withdrawal: { status: "COMPLETED" }, allWithdrawals: [], refund: null,
    } }), binding)).toThrow();
  });
  it("handles cancel/fill races by fetching status after acknowledgement", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json(fixture({ fillStatus: "FILLED" })));
    const order = await new OneClickOrders("test-key", fetcher, true).cancel(binding);
    expect(order.fillStatus).toBe("FILLED");
    expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(["POST", "GET"]);
  });
  it("never retries ambiguous creates and never leaks transport error details", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("secret credential"));
    const client = new OneClickOrders("test-key", fetcher, true);
    await expect(client.create(preview, accountId)).rejects.toMatchObject({ outcomeUnknown: true, code: "transport-error" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("returns structured rate limits without provider detail strings", async () => {
    const client = new OneClickOrders("test-key", async () => Response.json({ errors: [{ code: "rate-limit-exceeded", detail: "private data" }] }, { status: 429, headers: { "retry-after": "30" } }));
    try { await client.get(binding); throw new Error("Expected failure"); }
    catch(e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect(e).toMatchObject({ status: 429, code: "rate-limit-exceeded", retryAfterSeconds: 30, outcomeUnknown: false });
      expect((e as Error).message).not.toContain("private data");
    }
  });
  it("retains the provider minimum explanation for a definite order rejection (mock minimum only)", async () => {
    const reason = "Order amount is below the minimum of 12.34 USD.";
    const fetcher = vi.fn(async () => Response.json({ errors: [{ code: "order-rejected", detail: reason }] }, { status: 400 }));
    await expect(new OneClickOrders("test-key", fetcher, true).create(preview, accountId)).rejects.toMatchObject({
      status: 400, code: "order-rejected", outcomeUnknown: false, rejectionReason: reason,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(["private " + "a".repeat(64), "See https://example.com", "invalid\nresponse", "x".repeat(241)])("omits unsafe or oversized rejection details", async detail => {
    const fetcher = vi.fn(async () => Response.json({ errors: [{ code: "order-rejected", detail }] }, { status: 400 }));
    await expect(new OneClickOrders("test-key", fetcher, true).create(preview, accountId)).rejects.toMatchObject({ rejectionReason: undefined });
  });
  it("rejects path injection before network access", async () => {
    const fetcher = vi.fn();
    await expect(new OneClickOrders("test-key", fetcher).get({ ...binding, id: "../tokens" })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it.each(['2026-10-19T00:00:00Z', undefined, 'invalid'])("retains a provider fill timestamp only when supplied and valid (%s)", createdAt => {
  const parsed = parseOrder(fixture({ partialFills: [{ id: 'fill-time', amountIn: '1', amountOut: '1', createdAt }] }), binding);
  expect(parsed.partialFills[0].createdAt).toBe(createdAt?.startsWith('2026') ? Date.parse(createdAt) : undefined);
});

it("wires server-owned limit fee terms and binds all normalized fees on later reads", async () => {
  const plan: FeePlan={kind:"limit",revision:1,maxTotalBps:40,recipient:"treasury.near",requestedDyaBps:20};
  const allocations=[{recipient:plan.recipient,fee:20},{recipient:"provider.near",fee:20}];
  const transport=vi.fn(async (_url:unknown,init?:RequestInit)=>{
    if(init?.method==="POST") expect(JSON.parse(String(init.body)).data.attributes.appFees).toEqual([allocations[0]]);
    return Response.json(fixture({appFees:allocations}));
  });
  const client=new OneClickOrders("synthetic",transport,true);
  const created=await client.create({...preview,feePlan:plan},accountId);
  expect(created.feeReceipt).toMatchObject({plan,totalBps:40});
  expect((await client.get({...binding,feePlan:plan})).feeReceipt).toEqual(created.feeReceipt);
  expect(()=>parseOrder(fixture({appFees:[allocations[0],{recipient:"provider.near",fee:21}]}),{...binding,feePlan:plan})).toThrow();
  expect(()=>parseOrder(fixture(),{...binding,feePlan:plan})).toThrow();
});

it.each(["buy", "sell"] as const)("checks the limit %s create/read/cancel fee route independently (mock provider only)", async side => {
  const plan: FeePlan={kind:"limit",revision:2,maxTotalBps:40,recipient:"treasury.near",requestedDyaBps:20};
  const p={...previewLimit({side,quantity:"1",price:"4",expiryHours:1},{accountId,blockHeight:1,checkedAt:Date.now(),assets:ASSETS.map(a=>({...a,amount:"100",raw:"100000000"}))}),feePlan:plan};
  let canceled=false;
  const transport=vi.fn(async(url:unknown,init?:RequestInit)=>{
    if(String(url).endsWith("/cancel")) {canceled=true;return new Response(null,{status:204});}
    if(init?.method==="POST") expect(JSON.parse(String(init.body)).data.attributes.appFees).toEqual([{recipient:plan.recipient,fee:20}]);
    const buy=side==="buy";
    return Response.json({data:{id:"fee-limit",type:"orders",attributes:{...p.request.data.attributes,fillStatus:canceled?"PENDING_CANCEL":"AWAITING_DEPOSIT",payoutStatus:"NOT_STARTED",isPayoutStatusFinal:false,depositAddress:"deposit.near",depositedAmount:"0",partialFills:[],appFees:[{recipient:plan.recipient,fee:20},{recipient:"provider.near",fee:20}],swapView:{swapType:buy?"EXACT_OUTPUT":"EXACT_INPUT",originAsset:ASSETS[buy?1:0].assetId,destinationAsset:ASSETS[buy?0:1].assetId,...(buy?{maxAmountIn:"4000000"}:{amountIn:p.request.data.attributes.quantity})}}}});
  });
  const client=new OneClickOrders("synthetic",transport,true,"synthetic-user");
  const created=await client.create(p,accountId);
  expect(created.feeReceipt?.totalBps).toBe(40);
  const a=p.request.data.attributes;
  const terms={id:created.id,accountId,side:a.side as "BUY"|"SELL",quantity:a.quantity,price:a.price,baseAsset:a.baseAsset,quoteAsset:a.quoteAsset,deadline:a.deadline,feePlan:plan};
  expect((await client.get(terms)).feeReceipt).toEqual(created.feeReceipt);
  expect((await client.cancel(terms)).fillStatus).toBe("PENDING_CANCEL");
  expect(transport).toHaveBeenCalledTimes(4);
});
