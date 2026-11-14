import type { FeePlan } from "../../../packages/wallet-contracts/src/domain/trading-fees";
import { verifyFeeAllocations } from "../../../backend/id/src/near/services/fee-verification";
import { approvedTestTokens } from "./fixtures/token-policy";
import { DEFAULT_PAIR } from "../../../packages/wallet-contracts/src/domain/catalog";
// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { runLimitOrders } from "../../../backend/id/src/near/services/limit-orders-workflow";
import { previewLimit } from "@/lib/near/domain/limit-preview";
import { ASSETS } from "@/lib/near/domain/assets";
import { privateAssetId, PRIVATE_SALT } from "@/lib/near/domain/confidential";
import { hash, type State, type StateStore } from "../../../backend/id/src/near/repositories/store";
import { validateFunding } from "../../../backend/id/src/near/services/funding";
import { rememberConfidentialSession } from "../../../backend/id/src/near/services/confidential-sessions";
import type { AccountWorkflowContext } from "../../../backend/id/src/near/services/workflow-context";
const workflowCatalog = () => [{ ...DEFAULT_PAIR.base, coingeckoId: "near" }, { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" }];
vi.mock("../../../backend/id/src/near/providers/catalog", async original => { const actual=await original<typeof import("../../../backend/id/src/near/providers/catalog")>(); return {...actual, readCatalog: async()=>workflowCatalog(), resolvePair: (body:Record<string,unknown>)=>actual.resolvePair(body,async()=>workflowCatalog())}; });
const mocks = vi.hoisted(() => ({ verify: vi.fn(), submit: vi.fn(), simulation: vi.fn() }));
vi.mock("../../../backend/id/src/near/auth/passkeys", () => ({ verifyAssertion: mocks.verify }));
vi.mock("../../../backend/id/src/near/auth/intents", async original => ({ ...await original<typeof import("../../../backend/id/src/near/auth/intents")>(), accountIdentity: () => ({ accountId: "0x" + "a".repeat(40) }), encodeAssertion: (_identity: unknown, payload: string) => ({ standard: "webauthn", payload }), simulateSignedIntents: mocks.simulation }));
vi.mock("../../../backend/id/src/near/services/funding", async original => ({ ...await original<typeof import("../../../backend/id/src/near/services/funding")>(), submitFunding: mocks.submit }));
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("CONFIDENTIAL_SESSION_KEY", "11".repeat(32)); mocks.verify.mockResolvedValue(2); mocks.submit.mockResolvedValue({ intentHash: "4".repeat(44) }); });
const unlock = (context: AccountWorkflowContext) => rememberConfidentialSession(context.store, context.session!, context.account.id, { accessToken: "test-user", refreshToken: "test-refresh", expiresIn: 600, refreshExpiresIn: 3600 });
function setup() {
  const now = Date.now(), session = "session", accountId = "0x" + "a".repeat(40);
  const account = { id: "user", kind: "passkey" as const, publicKey: "test", counter: 1 };
  const preview = previewLimit({ side: "buy", quantity: "1", price: "4", expiryHours: 24 }, { accountId, checkedAt: now, blockHeight: 1, assets: ASSETS.map(a => ({ ...a, raw: "100000000", amount: "100" })) }, Date.now(), { ...DEFAULT_PAIR, base: workflowCatalog()[0], quote: workflowCatalog()[1] });
  const order = { id: "order", ownerId: account.id, requestId: "request", terms: "", preview, createdAt: now, updatedAt: now, state: "created" as const,
    provider: { id: "provider", fillStatus: "AWAITING_DEPOSIT" as const, payoutStatus: "NOT_STARTED", payoutFinal: false, depositAddress: "deposit.near", fundingAmount: "4000000", inputAsset: ASSETS[1].assetId, depositedAmount: "0", partialFills: [] } };
  const payload = JSON.stringify({ signer_id: accountId, verifying_contract: "intents.far", nonce: Buffer.concat([Buffer.from(`5628f6c600${PRIVATE_SALT}`, "hex"), Buffer.alloc(23, 1)]).toString("base64"), deadline: new Date(now + 60000).toISOString(), intents: [{ intent: "transfer", receiver_id: "deposit.near", tokens: { [privateAssetId(ASSETS[1].assetId)]: "4000000" } }] });
  const funding = validateFunding({ intent: { standard: "webauthn", payload } }, order);
  const state: State = { tokens: Object.fromEntries(approvedTestTokens(workflowCatalog()).map(t=>[t.id,t])), accounts: { user: account }, sessions: { [hash(session)]: { accountId: account.id, expires: now + 60000 } }, challenges: {}, requests: [], liveOrders: { order } };
  const challenge = { purpose: "order" as const, value: funding.challenge, payload, funding, accountId: account.id, expires: now + 60000 };
  state.challenges[hash("ceremony")] = challenge;
  const store: StateStore = { read: fn => fn(state), transaction: fn => fn(state) };
  const context = { route: "live/orders/submit", account, session, store, ceremony: "ceremony", body: {} } as unknown as AccountWorkflowContext;
  return { context, state, challenge };
}
it("submits privately, persists funding state, and never uses public simulation", async () => {
  const { context, state } = setup();
  await unlock(context);
  expect((await runLimitOrders(context))?.body).toMatchObject({ order: { fundingState: "submitted" } });
  expect(state.liveOrders!.order.fundingIntentHash).toBe("4".repeat(44));
  expect(mocks.simulation).not.toHaveBeenCalled();
  await expect(runLimitOrders(context)).rejects.toThrow(/Challenge/);
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(mocks.submit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "test-user");
});
it("retains unknown funding and blocks a second ceremony from funding again", async () => {
  const { context, state, challenge } = setup();
  await unlock(context);
  mocks.submit.mockRejectedValue(new Error("response lost"));
  await expect(runLimitOrders(context)).rejects.toThrow("outcome is unknown");
  expect(state.liveOrders!.order.fundingState).toBe("unknown");
  state.challenges[hash("another")] = challenge;
  await expect(runLimitOrders({ ...context, ceremony: "another" })).rejects.toThrow("not eligible");
  expect(mocks.submit).toHaveBeenCalledTimes(1);
});
it("rejects cancellation racing with signature verification", async () => {
  const { context, state } = setup();
  await unlock(context);
  mocks.verify.mockImplementation(async () => { state.liveOrders!.order.cancelPending = true; return 2; });
  await expect(runLimitOrders(context)).rejects.toThrow("not eligible");
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("asks to unlock without recording a submission when the user's 1Click session is missing", async () => {
  const { context, state } = setup();
  await expect(runLimitOrders(context)).rejects.toThrow("Unlock confidential balances");
  expect(state.liveOrders!.order.fundingState).toBeUndefined();
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("rejects legacy public order ceremonies before verifying or submitting", async () => {
  const { context, state } = setup();
  state.liveOrders!.order.preview.request.data.attributes.confidentiality = "basic";
  await expect(runLimitOrders(context)).rejects.toThrow();
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("with DYA fees off creates, generates private funding, and cancels using the same authenticated identity (mock provider)", async () => {
  const { context, state } = setup();
  vi.stubEnv("ONE_CLICK_JWT", "test-partner");
  const fixture = state.liveOrders!.order;
  const payload = state.challenges[hash("ceremony")].payload;
  state.liveOrders = {};
  await unlock(context);
  let attributes: Record<string, unknown> = {}, canceled = false;
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    expect(headers.get("X-API-Key")).toBe("test-partner");
    expect(headers.get("Authorization")).toBe("Bearer test-user");
    if (String(url).endsWith("/generate-intent")) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ type: "swap_transfer", signerId: fixture.preview.request.data.attributes.recipient, depositAddress: "deposit.near" });
      return Response.json({ intent: { standard: "webauthn", payload } });
    }
    if (String(url).endsWith("/cancel")) { canceled = true; return new Response(null, { status: 204 }); }
    if (init?.method === "POST") {
      attributes = JSON.parse(String(init.body)).data.attributes;
      expect(attributes.appFees).toBeUndefined();
      expect(attributes).toMatchObject({ confidentiality: "advanced", depositType: "CONFIDENTIAL_INTENTS", recipientType: "CONFIDENTIAL_INTENTS", refundType: "CONFIDENTIAL_INTENTS" });
    }
    return Response.json({ data: { id: "provider", type: "orders", attributes: { ...attributes, depositAddress: "deposit.near", fillStatus: canceled ? "PENDING_CANCEL" : "AWAITING_DEPOSIT", payoutStatus: "NOT_STARTED", isPayoutStatusFinal: false, depositedAmount: "0", partialFills: [], swapView: { swapType: "EXACT_OUTPUT", originAsset: ASSETS[1].assetId, destinationAsset: ASSETS[0].assetId, maxAmountIn: "4000000" } } } });
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    const prepared = await runLimitOrders({ ...context, route: "live/orders/prepare", account: { ...context.account, credentialId: "credential" }, deployment: { rpId: "localhost" } as AccountWorkflowContext["deployment"], url: new URL("http://localhost:3100"), body: { side: "buy", quantity: "1", price: "4", expiryHours: 24, requestId: "request" }, balanceReader: async () => ({ accountId: fixture.preview.request.data.attributes.recipient, checkedAt: Date.now(), blockHeight: 0, assets: ASSETS.map(a => ({ ...a, raw: "100000000", amount: "100" })) }) });
    expect(prepared?.body).toMatchObject({ review: { submissionEnabled: true, fundingAmount: "4" } });
    const localId = Object.keys(state.liveOrders!)[0];
    state.liveOrders![localId].preparationIds = ["retry-reference"];
    const result = await runLimitOrders({ ...context, route: "live/orders/abandon", body: { requestId: "retry-reference" } });
    expect(result?.body).toEqual({ ok: true });
    expect(state.liveOrders![localId]).toMatchObject({ cancelPending: true, provider: { fillStatus: "PENDING_CANCEL", payoutFinal: false } });
    expect(mocks.simulation).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});

it("does not abandon an attempt whose funding outcome is unknown", async () => {
  const { context, state } = setup();
  state.liveOrders!.order.fundingState = "unknown";
  await expect(runLimitOrders({ ...context, route: "live/orders/abandon", body: { requestId: "request" } })).rejects.toThrow("Funding may have started");
  expect(state.liveOrders!.order.cancelPending).toBeUndefined();
});
it("does not abandon another account's attempt", async () => {
  const { context, state } = setup();
  state.liveOrders!.order.ownerId = "someone-else";
  expect((await runLimitOrders({ ...context, route: "live/orders/abandon", body: { requestId: "request" } }))?.body).toEqual({ ok: true });
  expect(state.liveOrders!.order.cancelPending).toBeUndefined();
});

it("requires the exact normalized fee receipt before funding a fee-bound limit order",()=>{
  const {state}=setup();
  const order=state.liveOrders!.order;
  const plan:FeePlan={kind:"limit",revision:2,maxTotalBps:40,recipient:"treasury.near",requestedDyaBps:20};
  order.preview.feePlan=plan;
  const payload=state.challenges[hash("ceremony")].payload;
  const value={intent:{standard:"webauthn",payload}};
  expect(()=>validateFunding(value,order)).toThrow("fee allocation");
  order.provider!.feeReceipt=verifyFeeAllocations([{recipient:plan.recipient,fee:20},{recipient:"provider.near",fee:20}],plan);
  expect(validateFunding(value,order).amount).toBe("4000000");
  order.preview.feePlan={...plan,revision:3};
  expect(()=>validateFunding(value,order)).toThrow("fee allocation");
});

it("can still cancel an existing fee-bound order after DYA fee collection is off (mock provider)",async()=>{
 const {context,state}=setup();await unlock(context);vi.stubEnv("ONE_CLICK_JWT","test-partner");
 const order=state.liveOrders!.order;
 const plan:FeePlan={kind:"limit",revision:1,maxTotalBps:40,recipient:"treasury.near",requestedDyaBps:20};
 order.preview.feePlan=plan;order.provider!.feeReceipt=verifyFeeAllocations([{recipient:plan.recipient,fee:20},{recipient:"provider.near",fee:20}],plan);
 let canceled=false;
 const transport=vi.fn(async(url:unknown)=>{
  if(String(url).endsWith("/cancel")){canceled=true;return new Response(null,{status:204});}
  return Response.json({data:{type:"orders",id:"provider",attributes:{...order.preview.request.data.attributes,fillStatus:canceled?"PENDING_CANCEL":"AWAITING_DEPOSIT",payoutStatus:"NOT_STARTED",isPayoutStatusFinal:false,depositAddress:"deposit.near",depositedAmount:"0",partialFills:[],appFees:order.provider!.feeReceipt!.allocations,swapView:{swapType:"EXACT_OUTPUT",originAsset:ASSETS[1].assetId,destinationAsset:ASSETS[0].assetId,maxAmountIn:"4000000"}}}});
 });
 vi.stubGlobal("fetch",transport);
 try{
  const result=await runLimitOrders({...context,route:"live/orders/cancel",body:{id:"order"}});
  expect(result?.body).toMatchObject({order:{cancelPending:true,provider:{fillStatus:"PENDING_CANCEL",feeReceipt:{totalBps:40}}}});
  expect(mocks.submit).not.toHaveBeenCalled();
 }finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
});
