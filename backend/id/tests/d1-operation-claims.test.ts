import { approvedTestTokens } from "../../../frontend/app/tests/fixtures/token-policy";
import { batch, balances, catalog as fundingCatalog } from "./fixtures/funding";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { hash } from "../src/near/repositories/store";
import { harness, origin, synchronized } from "./d1-harness";
import { runMarketTrades } from "../src/near/services/market-trades-workflow";
import { runTransfers } from "../src/near/services/transfers-workflow";
import { runFundingConversions } from "../src/near/services/funding-conversions-workflow";
import { runLimitOrders } from "../src/near/services/limit-orders-workflow";
import { OrderService } from "../src/near/services/orders";
import type { AccountWorkflowContext } from "../src/near/services/workflow-context";
import { DEFAULT_PAIR } from "../../../packages/wallet-contracts/src/domain/catalog";
import { ASSETS } from "../../../packages/wallet-contracts/src/domain/assets";
import { previewLimit } from "../../../packages/wallet-contracts/src/domain/limit-preview";
import { validateFunding } from "../src/near/services/funding";
import { rememberConfidentialSession } from "../src/near/services/confidential-sessions";
import { PRIVATE_SALT, privateAssetId } from "../../../packages/wallet-contracts/src/domain/confidential";
// Cryptography/provider-validation have existing unmodified real-fixture regression lanes.
// These tests isolate claim ordering with mocked provider/verification functions on real D1.
const operationCatalog = () => [{...DEFAULT_PAIR.base,coingeckoId:"near"},{...DEFAULT_PAIR.quote,coingeckoId:"usd-coin"}];
vi.mock("../src/near/providers/catalog", async original => { const actual=await original<typeof import("../src/near/providers/catalog")>(); return {...actual,readCatalog:async()=>[...new Map([...operationCatalog(),...fundingCatalog].map(a=>[a.assetId,a])).values()],resolvePair:(body:Record<string,unknown>)=>actual.resolvePair(body,async()=>operationCatalog())}; });
const mocks = vi.hoisted(() => ({ verify: vi.fn(), market: vi.fn(), withdrawal: vi.fn(), funding: vi.fn() }));
vi.mock("../src/near/auth/passkeys", () => ({verifyAssertion: mocks.verify}));
vi.mock("../src/near/auth/intents", async original => ({ ...await original<typeof import("../src/near/auth/intents")>(), accountIdentity: () => ({accountId: "0x" + "a".repeat(40)}), encodeAssertion: (_identity: unknown, payload: string) => ({standard: "webauthn", payload}) }));
vi.mock("../src/near/services/market-execution", async original => ({ ...await original<typeof import("../src/near/services/market-execution")>(), validateExecutableMarketTrade: vi.fn(), publishMarketIntent: mocks.market }));
vi.mock("../src/near/services/one-click-withdraw", async original => ({ ...await original<typeof import("../src/near/services/one-click-withdraw")>(), validateWithdrawal: vi.fn(), publishWithdrawal: mocks.withdrawal }));
vi.mock("../src/near/services/funding", async original => ({ ...await original<typeof import("../src/near/services/funding")>(), submitFunding: mocks.funding }));
let h: Awaited<ReturnType<typeof harness>>;
const account = {id: "user", kind: "passkey" as const, publicKey: "synthetic", credentialId: "credential", counter: 1};
const s = (db = h.db) => new D1Store(db, origin, new StatementBudget("paid"));
beforeEach(async () => {
  vi.resetAllMocks(); mocks.verify.mockResolvedValue(2); mocks.market.mockResolvedValue({intentHash: "synthetic-market"}); mocks.withdrawal.mockResolvedValue({intentHash: "synthetic-withdrawal"}); mocks.funding.mockResolvedValue({intentHash: "synthetic-funding"});
  h = await harness();
  await s().transaction(state => { state.tokens=Object.fromEntries(approvedTestTokens([...operationCatalog(),...fundingCatalog]).map(t=>[t.id,t])); state.accounts.user = account; state.sessions[hash("session")] = {accountId: account.id, expires: Date.now()+60000}; });
});
afterEach(async () => { vi.unstubAllEnvs(); await h?.mf.dispose(); });
const context = (store: D1Store, route: string, ceremony: string) => ({store, route, account, session: "session", ceremony, body: {}, url: new URL(origin), deployment: {origin, rpId: "localhost"}} as unknown as AccountWorkflowContext);
test.each(["market-trade", "withdraw"] as const)("%s_claim_precedes_one_mocked_publish", async purpose => {
  const review = {confidentiality: "advanced", pair: {...DEFAULT_PAIR,base:operationCatalog()[0],quote:operationCatalog()[1]}, originAsset:DEFAULT_PAIR.base.assetId,destinationAsset:DEFAULT_PAIR.base.assetId,asset:"wNEAR",destinationWallet:"user.near",route:{origin:operationCatalog()[0],destination:operationCatalog()[0]}};
  await s().transaction(state => { for (const name of ["first", "second"]) state.challenges[hash(name)] = {purpose, value: "proof", payload: "synthetic-private", accountId: account.id, expires: Date.now()+60000, ...(purpose === "market-trade" ? {marketTrade: review as never} : {withdrawal: review as never})}; });
  const db = synchronized(h.db);
  const route = purpose === "market-trade" ? "live/market/submit" : "transfers/submit";
  const workflow = purpose === "market-trade" ? runMarketTrades : runTransfers;
  const result = await Promise.allSettled([workflow(context(s(db), route, "first")), workflow(context(s(db), route, "second"))]);
  expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(purpose === "market-trade" ? mocks.market : mocks.withdrawal).toHaveBeenCalledTimes(1);
  const records = await s().read(state => Object.values(purpose === "market-trade" ? state.liveTrades! : state.withdrawals!));
  expect(records).toHaveLength(1); expect(records[0].state).toBe("submitted");
});
function fundingFixture() {
  const now = Date.now(), identity = "0x"+"a".repeat(40);
  const preview = previewLimit({side: "buy", quantity: "1", price: "4", expiryHours: 24}, {accountId: identity, checkedAt: now, blockHeight: 1, assets: ASSETS.map(a => ({...a, raw: "100000000", amount: "100"}))}, now, {...DEFAULT_PAIR,base:operationCatalog()[0],quote:operationCatalog()[1]});
  const order = {id: "order", ownerId: account.id, requestId: "request", terms: "", preview, createdAt: now, updatedAt: now, state: "created" as const, provider: {id: "provider", fillStatus: "AWAITING_DEPOSIT" as const, payoutStatus: "NOT_STARTED", payoutFinal: false, depositAddress: "deposit.near", fundingAmount: "4000000", inputAsset: ASSETS[1].assetId, depositedAmount: "0", partialFills: []}};
  const payload = JSON.stringify({signer_id: identity, verifying_contract: "intents.far", nonce: Buffer.concat([Buffer.from(`5628f6c600${PRIVATE_SALT}`, "hex"), Buffer.alloc(23,1)]).toString("base64"), deadline: new Date(now+60000).toISOString(), intents: [{intent: "transfer", receiver_id: "deposit.near", tokens: {[privateAssetId(ASSETS[1].assetId)]: "4000000"}}]});
  return {order, payload, funding: validateFunding({intent: {standard: "webauthn", payload}}, order)};
}
test("funding_claim_cannot_duplicate_or_overwrite_cancellation", async () => {
  const {order, payload, funding} = fundingFixture();
  await s().transaction(state => { state.liveOrders = {order}; for (const name of ["first", "second"]) state.challenges[hash(name)] = {purpose: "order", value: funding.challenge, payload, funding, accountId: account.id, expires: Date.now()+60000}; });
  // Funding submission carries the user's 1Click session.
  vi.stubEnv("CONFIDENTIAL_SESSION_KEY", "11".repeat(32));
  await rememberConfidentialSession(s(), "session", account.id, {accessToken: "synthetic-user", refreshToken: "synthetic-refresh", expiresIn: 600, refreshExpiresIn: 3600});
  const db = synchronized(h.db);
  const results = await Promise.allSettled([runLimitOrders(context(s(db), "live/orders/submit", "first")), runLimitOrders(context(s(db), "live/orders/submit", "second"))]);
  expect(mocks.funding).toHaveBeenCalledTimes(1);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(await s().read(state => state.liveOrders!.order.fundingState)).toBe("submitted");
});
test("order_creation_has_one_provider_claim", async () => {
  const {order} = fundingFixture();
  const create = vi.fn(async () => order.provider);
  const db = synchronized(h.db);
  const provider = {create, get: vi.fn(), cancel: vi.fn()};
  const results = await Promise.all([new OrderService(s(db), provider, true).create("session", "request", order.preview), new OrderService(s(db), provider, true).create("session", "request", order.preview)]);
  expect(create).toHaveBeenCalledTimes(1); expect(results[0].id).toBe(results[1].id);
});
test("funding_conversion_cancel_keeps_unresolved_leg", async () => {
  await s().transaction(state => { const fixture = batch(); fixture.legs[0].state = "unknown"; state.accounts.user.fundingBatches = {batch: fixture}; });
  await runFundingConversions({...context(s(), "funding/cancel", ""), body: {id: "batch"}});
  expect(await s().read(state => state.accounts.user.fundingBatches!.batch.legs.map(l => l.state))).toEqual(["unknown", "cancelled"]);
});

test("funding_leg_submission_claim_is_single_use", async () => {
  const fixture = batch(), leg = fixture.legs[0];
  await s().transaction(state => {
    state.accounts.user.fundingBatches = {batch: fixture};
    for (const name of ["first", "second"]) state.challenges[hash(name)] = {purpose: "funding-conversion", value: "proof", accountId: account.id, fundingBatchId: fixture.id, fundingLegId: leg.id, payload: leg.review.payload, expires: Date.now()+60000};
  });
  const db = synchronized(h.db);
  const result = await Promise.allSettled(["first", "second"].map(ceremony => runFundingConversions({...context(s(db), "funding/submit", ceremony), balanceReader: async () => balances})));
  expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(mocks.market).toHaveBeenCalledTimes(1);
  expect(await s().read(state => state.accounts.user.fundingBatches!.batch.legs[0].state)).toBe("submitted");
});

test.each(["market-trade", "withdraw"] as const)("%s_rechecks_token_permission_after_signature_verification", async purpose => {
  const [base, quote] = operationCatalog();
  const review = { confidentiality:"advanced", pair:{...DEFAULT_PAIR,base,quote}, originAsset:base.assetId,destinationAsset:base.assetId,asset:"wNEAR",destinationWallet:"user.near",route:{origin:base,destination:base} };
  await s().transaction(state=>{state.challenges[hash('revoked')]={purpose,value:'proof',payload:'synthetic-private',accountId:account.id,expires:Date.now()+60000,...(purpose==='market-trade'?{marketTrade:review as never}:{withdrawal:review as never})};});
  mocks.verify.mockImplementation(async()=>{await s().transaction(state=>{state.tokens![base.assetId].status='disabled';});return 2;});
  const workflow=purpose==='market-trade'?runMarketTrades:runTransfers;
  await expect(workflow(context(s(),purpose==='market-trade'?'live/market/submit':'transfers/submit','revoked'))).rejects.toThrow('This token');
  expect(mocks.market).not.toHaveBeenCalled();expect(mocks.withdrawal).not.toHaveBeenCalled();
  expect(await s().read(state=>state.accounts.user.counter)).toBe(1);
});

test("limit_funding_rechecks_token_permission_after_signature_verification", async () => {
  const {order,payload,funding}=fundingFixture();
  await s().transaction(state=>{state.liveOrders={order};state.challenges[hash('revoked-limit')]={purpose:'order',value:funding.challenge,payload,funding,accountId:account.id,expires:Date.now()+60000};});
  vi.stubEnv('CONFIDENTIAL_SESSION_KEY','11'.repeat(32));
  await rememberConfidentialSession(s(),'session',account.id,{accessToken:'synthetic-user',refreshToken:'synthetic-refresh',expiresIn:600,refreshExpiresIn:3600});
  mocks.verify.mockImplementation(async()=>{await s().transaction(state=>{state.tokens![DEFAULT_PAIR.base.assetId].status='disabled';});return 2;});
  await expect(runLimitOrders(context(s(),'live/orders/submit','revoked-limit'))).rejects.toThrow('This token');
  expect(mocks.funding).not.toHaveBeenCalled();
  expect(await s().read(state=>state.liveOrders!.order.fundingState)).toBeUndefined();
});
