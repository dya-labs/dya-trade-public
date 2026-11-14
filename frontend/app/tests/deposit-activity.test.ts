import { expect, it } from "vitest";
import { isAwaitingDeposit, depositStatusLabel } from "@/lib/near/domain/deposit-activity";

it("separates unused instructions from transfers with detected funds", () => {
  expect(isAwaitingDeposit({ status: "PENDING_DEPOSIT" })).toBe(true);
  expect(isAwaitingDeposit({ status: "PENDING_DEPOSIT", originChainTxHashes: ["tx"] })).toBe(false);
  for (const status of ["KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const) {
    expect(isAwaitingDeposit({ status })).toBe(false);
  }
});

it("distinguishes awaiting funds from processing", () => {
  expect(depositStatusLabel("PENDING_DEPOSIT")).toBe("Awaiting deposit");
  expect(depositStatusLabel("KNOWN_DEPOSIT_TX")).toBe("Deposit detected");
  expect(depositStatusLabel("PROCESSING")).toBe("Processing");
});
