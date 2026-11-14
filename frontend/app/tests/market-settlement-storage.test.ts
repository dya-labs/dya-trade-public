// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { runMarketTrades } from "../../../backend/id/src/near/services/market-trades-workflow";
import { readDepositStatus } from "../../../backend/id/src/near/services/one-click-deposit";
import { emptyState, type StateStore } from "../../../backend/id/src/near/repositories/store";
import type { AccountWorkflowContext } from "../../../backend/id/src/near/services/workflow-context";
import type { LiveTrade } from "@dya/wallet-contracts/src/domain/state";
import { fixtures, setTradesState } from "@/stories/trades/api-mocks";
vi.mock("../../../backend/id/src/near/services/one-click-deposit", () => ({ readDepositStatus: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
function setup() {
  setTradesState("Processing");
  const state = emptyState();
  const trade = { ...fixtures()[0], ownerId: "alice" } as LiveTrade;
  state.liveTrades = { [trade.id]: trade };
  const store: StateStore = { read: fn => fn(structuredClone(state)), transaction: fn => fn(state) };
  const context = { route: "live/trades/status", body: { id: trade.id }, account: { id: "alice" }, store } as unknown as AccountWorkflowContext;
  return { context, state, trade };
}
const execution = { inputRaw: "8000000", outputRaw: "2000000000000000000000000", inputAmount: "8", outputAmount: "2", settledAt: 1790000000000 };
it("stores confirmed raw and human amounts after success, independent of the original quote", async () => {
  const { context, state, trade } = setup();
  vi.mocked(readDepositStatus).mockResolvedValue({ status: "SUCCESS", terminal: true, creditedAmount: undefined, originChainTxHashes: [], destinationChainTxHashes: [], updatedAt: new Date().toISOString(), nearTxHashes: [], execution });
  await runMarketTrades(context);
  expect(state.liveTrades![trade.id]).toMatchObject({ state: "settled", execution });
  expect(state.liveTrades![trade.id].review.estimatedOutput).not.toBe(execution.outputAmount);
});
it.each([undefined, { ...execution, outputAmount: "999" }])("does not substitute quotes for missing or inconsistent actual amounts", async amounts => {
  const { context, state, trade } = setup();
  vi.mocked(readDepositStatus).mockResolvedValue({ status: "SUCCESS", terminal: true, creditedAmount: undefined, originChainTxHashes: [], destinationChainTxHashes: [], updatedAt: new Date().toISOString(), nearTxHashes: [], execution: amounts });
  await runMarketTrades(context);
  expect(state.liveTrades![trade.id].execution).toBeUndefined();
});
it("rejects a different account before contacting the provider", async () => {
  const { context } = setup(); context.account.id = "bob";
  await expect(runMarketTrades(context)).rejects.toThrow("Trade not found");
  expect(readDepositStatus).not.toHaveBeenCalled();
});
