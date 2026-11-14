import { privateAssetId, PRIVATE_VERIFIER, PRIVATE_SALT } from "@/lib/near/domain/confidential";
// @vitest-environment node
import { expect, it } from "vitest";
import { ASSETS } from "@/lib/near/domain/assets";
import { previewLimit } from "@/lib/near/domain/limit-preview";
import { validateFunding, generateFunding, submitFunding } from "../../../backend/id/src/near/services/funding";
import type { StoredOrder } from "../../../backend/id/src/near/services/orders";
import { payloadChallenge } from "../../../backend/id/src/near/auth/intents";
const accountId = "0x" + "a".repeat(40);
const now = Date.now();
const preview = previewLimit({ side: "buy", quantity: "1", price: "4", expiryHours: 24 }, {
  accountId, checkedAt: now, blockHeight: 1, assets: ASSETS.map(a => ({...a, raw:"0", amount:"0"})),
}, now);
const order: StoredOrder = {
  id: "local-1", ownerId: "owner", requestId: "request-1", terms: "", preview,
  createdAt: now, updatedAt: now, state: "created",
  provider: { id:"provider-1", fillStatus:"AWAITING_DEPOSIT", payoutStatus:"NOT_STARTED",
    payoutFinal:false, depositAddress:"deposit.near", fundingAmount:"4010000",
    inputAsset:ASSETS[1].assetId, depositedAmount:"0", partialFills:[] },
};
function payload(patch: Record<string,unknown> = {}) {
  return { signer_id:accountId, verifying_contract:PRIVATE_VERIFIER,
    nonce:Buffer.concat([Buffer.from(`5628f6c600${PRIVATE_SALT}`, "hex"), Buffer.alloc(23, 1)]).toString("base64"), deadline:new Date(now+60000).toISOString(),
    intents:[{intent:"transfer",receiver_id:"deposit.near",tokens:{[privateAssetId(ASSETS[1].assetId)]:"4010000"}}], ...patch };
}
function envelope(p: unknown) { return { intent:{standard:"webauthn",payload:JSON.stringify(p,null,2)} }; }
it("preserves exact provider payload bytes and hashes the reviewed amount", () => {
  const value=envelope(payload()), result=validateFunding(value,order,now);
  expect(result.payload).toBe(value.intent.payload);
  expect(result.challenge).toBe(payloadChallenge(value.intent.payload).toString("base64url"));
  expect(result.amount).toBe("4010000");
});
it("rejects wrong identity, destination, amount, asset, extra intents and key operations", () => {
  for (const patch of [
    {signer_id:"attacker.near"}, {verifying_contract:"other.near"},
    {deadline:new Date(now-1).toISOString()}, {deadline:new Date(Date.parse(order.preview.request.data.attributes.deadline)+1).toISOString()},
    {nonce:"x"}, {intents:[]}, {intents:[{intent:"add_public_key"}]},
    {intents:[{intent:"transfer",receiver_id:"attacker.near",tokens:{[privateAssetId(ASSETS[1].assetId)]:"4010000"}}]},
    {intents:[{intent:"transfer",receiver_id:"deposit.near",tokens:{[privateAssetId(ASSETS[1].assetId)]:"4000000"}}]},
    {intents:[{intent:"transfer",receiver_id:"deposit.near",tokens:{[privateAssetId(ASSETS[0].assetId)]:"4010000"}}]},
    {extra:"unreviewed"},
  ]) expect(()=>validateFunding(envelope(payload(patch)),order,now)).toThrow();
});
it("accepts a provider payload bound to the full order deadline", () => {
  const deadline = order.preview.request.data.attributes.deadline;
  expect(validateFunding(envelope(payload({ deadline })), order, now).expiresAt).toBe(Date.parse(deadline));
});
it("rejects already funded and canceling orders",()=>{
  expect(()=>validateFunding(envelope(payload()),{...order,cancelPending:true},now)).toThrow();
  expect(()=>validateFunding(envelope(payload()),{...order,provider:{...order.provider!,depositedAmount:"1"}},now)).toThrow();
});
it("requests WebAuthn generation at the fixed endpoint as the order's owner without submitting anything", async()=>{
  let count=0;
  const result=await generateFunding(order,"test-key","user-session",async(url,init)=>{
    count++; expect(url).toBe("https://1click.chaindefuser.com/v0/generate-intent");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer user-session");
    expect(JSON.parse(init!.body as string)).toEqual({type:"swap_transfer",standard:"webauthn",signerId:accountId,depositAddress:"deposit.near"});
    return Response.json(envelope(payload()));
  });
  expect(count).toBe(1); expect(result.orderId).toBe(order.id);
});

it("blocks legacy public funding before any provider request or signature", async () => {
 const privateOrder = {...order, preview: {...preview, request: {data: {type: "orders", attributes: {...preview.request.data.attributes, depositType: "INTENTS"}}}}};
 expect(() => validateFunding(envelope(payload()), privateOrder, now)).toThrow(/confidential funding/i);
 let called = false;
 await expect(generateFunding(privateOrder, "test", "user-session", async () => {called = true; return Response.json({});})).rejects.toThrow(/confidential funding/i);
 expect(called).toBe(false);
});

it("submits only the signed funding payload through 1Click", async () => {
  const signed = { standard: "webauthn", payload: "{}", public_key: "p256:key", signature: "p256:sig", client_data_json: "{}", authenticator_data: "data" } as const;
  const result = await submitFunding(signed, "test-key", "user-session", async (url, init) => {
    expect(url).toBe("https://1click.chaindefuser.com/v0/submit-intent");
    expect(new Headers(init?.headers).get("X-API-Key")).toBe("test-key");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer user-session");
    expect(JSON.parse(String(init?.body))).toEqual({ type: "swap_transfer", signedData: signed });
    return Response.json({ intentHash: "4".repeat(44), correlationId: "funding-1" });
  });
  expect(result.intentHash).toBe("4".repeat(44));
});

it("validates limit-sell funding as an exact wNEAR transfer", () => {
  const sellPreview = previewLimit({ side: "sell", quantity: "0.1", price: "4", expiryHours: 24 }, {
    accountId, checkedAt: now, blockHeight: 1, assets: ASSETS.map(a => ({ ...a, raw: "0", amount: "0" })),
  }, now);
  const sellOrder: StoredOrder = { ...order, preview: sellPreview, provider: {
    ...order.provider!, inputAsset: ASSETS[0].assetId, fundingAmount: "100000000000000000000000",
  } };
  const sellIntent = payload({ intents: [{ intent: "transfer", receiver_id: "deposit.near", tokens: { [privateAssetId(ASSETS[0].assetId)]: "100000000000000000000000" } }] });
  expect(validateFunding(envelope(sellIntent), sellOrder, now)).toMatchObject({ assetId: ASSETS[0].assetId, amount: "100000000000000000000000" });
  expect(() => validateFunding(envelope(payload()), sellOrder, now)).toThrow();
});
it("identifies a funding-preparation connection failure without implying submission", async () => {
  await expect(generateFunding(order, "test-key", "user-session", async () => { throw new TypeError("fetch failed"); }))
    .rejects.toThrow("No funding was submitted. Retry preparation to reuse this order");
});
it("gives up on a hanging funding preparation within its time budget", async () => {
  const hanging: typeof fetch = (_url, init) => {
    const { promise, reject } = Promise.withResolvers<Response>();
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    return promise;
  };
  const started = Date.now();
  await expect(generateFunding(order, "test-key", "user-session", hanging, 50)).rejects.toThrow("No funding was submitted");
  expect(Date.now() - started).toBeLessThan(1_000);
});
it("reports provider HTTP failures separately from preparation timeouts", async () => {
  await expect(generateFunding(order, "test-key", "user-session", async () => new Response("internal provider detail", { status: 500 })))
    .rejects.toThrow("1Click could not prepare the funding signature (HTTP 500)");
});
