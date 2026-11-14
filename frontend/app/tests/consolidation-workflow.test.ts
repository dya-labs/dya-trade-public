// @vitest-environment node
import { expect, it, vi } from "vitest";
import { runConsolidation } from "../../../backend/id/src/near/services/consolidation-workflow";
import { hash, type State, type StateStore } from "../../../backend/id/src/near/repositories/store";
import type { AccountWorkflowContext } from "../../../backend/id/src/near/services/workflow-context";
import type { ConsolidationOperation, PreparedConsolidation } from "@/lib/near/http/schemas/consolidation";
const mocks = vi.hoisted(() => ({ relay: vi.fn(), verify: vi.fn(async () => 2) }));
vi.mock("../../../backend/id/src/near/auth/passkeys", () => ({ verifyAssertion: mocks.verify }));
vi.mock("../../../backend/id/src/near/auth/intents", () => ({ accountIdentity: () => ({ accountId: "identity" }), encodeAssertion: () => ({ standard: "webauthn" }) }));
vi.mock("../../../backend/id/src/near/services/consolidation", () => ({ validateConsolidation: () => "hash", relayRpc: mocks.relay }));
function setup() {
  const prepared = { review: { id: "move", expiresAt: new Date(Date.now() + 60000).toISOString(), inputs: [{ asset: { assetId: "base", decimals: 6 }, raw: "100" }] }, quoteHashes: ["quote"], payload: "payload" } as PreparedConsolidation;
  const account = { id: "user", kind: "passkey" as const, publicKey: "key", credentialId: "credential", counter: 1 };
  const state: State = { accounts: { user: account }, sessions: { [hash("session")]: { accountId: "user", expires: Date.now() + 60000 } }, challenges: { [hash("ceremony")]: { purpose: "consolidation", accountId: "user", expires: Date.now() + 60000, value: "challenge", consolidation: prepared } }, requests: [] };
  const store: StateStore = { read: fn => fn(state), transaction: fn => fn(state) };
  const context = { route: "funding/submit", body: {}, store, account, session: "session", ceremony: "ceremony", balanceReader: async () => ({ assets: [{ assetId: "base", raw: "100" }] }) } as unknown as AccountWorkflowContext;
  return { context, state };
}
it("persists the expected hash before publishing and rejects replay", async () => {
  const { context, state } = setup();
  mocks.relay.mockImplementationOnce(async () => { expect(state.accounts.user.consolidations?.move.state).toBe("submitting"); return { status: "OK", intent_hash: "hash" }; });
  const result = await runConsolidation(context);
  expect(result?.body).toMatchObject({ operation: { state: "submitted", intentHash: "hash" } });
  await expect(runConsolidation(context)).rejects.toThrow(/Challenge/);
  expect(state.accounts.user.counter).toBe(2);
});
it("retains unknown submissions durably when the relay times out", async () => {
  const { context, state } = setup();
  mocks.relay.mockRejectedValueOnce(new Error("timeout"));
  await runConsolidation(context);
  expect(state.accounts.user.consolidations?.move).toMatchObject({ state: "unknown", intentHash: "hash" });
});
it("refuses cross-account ceremonies before verifying signatures", async () => {
  const { context, state } = setup();
  state.challenges[hash("ceremony")].accountId = "someone-else";
  await expect(runConsolidation(context)).rejects.toThrow("mismatch");
});
it("does not turn a missing relay record into a retryable failure", async () => {
  const { context, state } = setup();
  state.accounts.user.consolidations = { move: { id: "move", state: "unknown", intentHash: "hash" } as ConsolidationOperation };
  mocks.relay.mockResolvedValueOnce({ intent_hash: "hash", status: "NOT_FOUND_OR_NOT_VALID" });
  const result = await runConsolidation({ ...context, route: "funding/status", body: { id: "move" } });
  expect(result?.body).toMatchObject({ operation: { state: "unknown" } });
});
