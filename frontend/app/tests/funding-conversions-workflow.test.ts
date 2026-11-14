import { approvedTestTokens } from "./fixtures/token-policy";
// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { runFundingConversions } from "../../../backend/id/src/near/services/funding-conversions-workflow";
import { hash, type State, type StateStore } from "../../../backend/id/src/near/repositories/store";
import type { AccountWorkflowContext } from "../../../backend/id/src/near/services/workflow-context";
import { batch, balances, identity, catalog } from "./fixtures/funding";
vi.mock("../../../backend/id/src/near/providers/catalog", () => ({ readCatalog: async () => catalog }));
const mocks = vi.hoisted(() => ({ publish: vi.fn(), status: vi.fn(), verify: vi.fn(async () => 2) }));
vi.mock("../../../backend/id/src/near/auth/passkeys", () => ({ verifyAssertion: mocks.verify }));
vi.mock("../../../backend/id/src/near/auth/intents", async importOriginal => ({ ...await importOriginal<typeof import("../../../backend/id/src/near/auth/intents")>(), accountIdentity: () => ({ accountId: "0x" + "a".repeat(40) }), encodeAssertion: (_identity: unknown, payload: string) => ({ standard: "webauthn", payload }) }));
vi.mock("../../../backend/id/src/near/services/market-execution", async importOriginal => ({ ...await importOriginal<typeof import("../../../backend/id/src/near/services/market-execution")>(), publishMarketIntent: mocks.publish }));
vi.mock("../../../backend/id/src/near/services/one-click-deposit", () => ({ readDepositStatus: mocks.status }));
beforeEach(() => vi.clearAllMocks());
function setup() {
  const operation = batch();
  const account = { id: "user", kind: "passkey" as const, publicKey: "key", credentialId: "credential", counter: 1, fundingBatches: { batch: operation } };
  const state: State = { tokens:Object.fromEntries(approvedTestTokens(catalog).map(t=>[t.id,t])), accounts: { user: account }, sessions: { [hash("session")]: { accountId: "user", expires: Date.now() + 60000 } }, challenges: { [hash("ceremony")]: { purpose: "funding-conversion", accountId: "user", expires: Date.now() + 60000, value: "challenge", fundingBatchId: "batch", fundingLegId: "0", payload: operation.legs[0].review.payload } }, requests: [] };
  const store: StateStore = { read: fn => fn(state), transaction: fn => fn(state) };
  const context = { route: "funding/submit", body: {}, store, account, session: "session", ceremony: "ceremony", balanceReader: async () => balances } as unknown as AccountWorkflowContext;
  return { context, state, operation };
}
it("persists submitting before sending unchanged private payload and rejects replay", async () => {
  const { context, operation } = setup();
  mocks.publish.mockImplementationOnce(async signed => { expect(operation.legs[0].state).toBe("submitting"); expect(signed.payload).toBe(operation.legs[0].review.payload); return { intentHash: "hash" }; });
  const result = await runFundingConversions(context);
  expect(result?.body).toMatchObject({ operation: { state: "processing", legs: [{ state: "submitted" }, { state: "ready" }] } });
  await expect(runFundingConversions(context)).rejects.toThrow(/Challenge/);
  expect(mocks.publish).toHaveBeenCalledTimes(1);
});
it("retains timeouts as unknown and cancels only unsigned routes", async () => {
  const { context, operation } = setup();
  mocks.publish.mockRejectedValueOnce(new Error("timeout"));
  await runFundingConversions(context);
  await runFundingConversions({ ...context, route: "funding/cancel", body: { id: "batch" } });
  expect(operation.legs.map(l => l.state)).toEqual(["unknown", "cancelled"]);
  mocks.status.mockResolvedValueOnce({ status: "PENDING_DEPOSIT" });
  const result = await runFundingConversions({ ...context, route: "funding/status", body: { id: "batch" } });
  expect(result?.body).toMatchObject({ operation: { state: "unknown" } });
  expect(mocks.publish).toHaveBeenCalledTimes(1);
});
it("reports partial settlement and prevents foreign account access", async () => {
  const { context, operation, state } = setup();
  operation.legs[0].state = "submitted"; operation.legs[1].state = "cancelled";
  mocks.status.mockResolvedValueOnce({ status: "SUCCESS" });
  expect((await runFundingConversions({ ...context, route: "funding/status", body: { id: "batch" } }))?.body).toMatchObject({ operation: { state: "partial" } });
  state.sessions[hash("session")].accountId = "other";
  state.accounts.other = { id: "other", kind: "passkey" };
  await expect(runFundingConversions({ ...context, route: "funding/cancel", body: { id: "batch" } })).rejects.toThrow();
});
it("rechecks private balances before publishing", async () => {
  const { context } = setup();
  await expect(runFundingConversions({ ...context, balanceReader: async () => ({ accountId: identity, assets: [], blockHeight: 0, checkedAt: 0 }) })).rejects.toThrow("balance changed");
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("blocks funding conversion publication when token approval is revoked during verification", async () => {
  const { context, state, operation } = setup();
  mocks.verify.mockImplementationOnce(async () => { state.tokens![operation.legs[0].asset.assetId].status = "disabled"; return 2; });
  await expect(runFundingConversions(context)).rejects.toThrow("This token");
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(operation.legs[0].state).toBe("ready");
});
