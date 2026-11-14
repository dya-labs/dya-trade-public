import { expect, it } from "vitest";
import { canReconcile, nextRevision, operationState, mergeHashes, isTerminalDeposit } from "@/lib/near/domain/reconciliation";
it("rejects late responses even when updates occur in the same millisecond", () => {
  const observed = { updatedAt: 100 };
  const current = { updatedAt: nextRevision(100, 100) };
  expect(canReconcile(current, observed)).toBe(false);
});
it("preserves terminal outcomes and known transaction hashes", () => {
  expect(operationState("settled", "FAILED")).toBe("settled");
  expect(operationState("failed", "SUCCESS")).toBe("failed");
  expect(operationState("submitted", "SUCCESS")).toBe("settled");
  expect(isTerminalDeposit("INCOMPLETE_DEPOSIT")).toBe(true);
  expect(mergeHashes(["one"], undefined)).toEqual(["one"]);
  expect(mergeHashes(["one"], ["one", "two"])).toEqual(["one", "two"]);
});
