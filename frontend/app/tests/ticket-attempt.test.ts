import { expect, it } from "vitest";
import { IDLE, attemptBusy, draftLocked, nextAttempt, type Attempt, type AttemptEvent } from "@/components/near/ticket-attempt";

function run(events: AttemptEvent[], from: Attempt = IDLE) {
  return events.reduce<Attempt>((state, event) => nextAttempt(state, event) ?? state, from);
}
const review = (order: "market" | "limit"): AttemptEvent => ({ type: "review", order, reusesQuote: order === "market" });
const everyEvent: AttemptEvent[] = [{ type: "unlock" }, review("market"), review("limit"), { type: "approval" }, { type: "submission" }, { type: "abandon", requestId: "other" }, { type: "abandonFailed" }, { type: "retryAbandon" }, { type: "lost" }, { type: "settle" }];

it("takes one Review at a time and returns to idle once the order is placed", () => {
  const preparing = run([review("market")]);
  expect(preparing).toEqual({ phase: "preparing", order: "market", reusesQuote: true });
  expect(nextAttempt(preparing, review("market"))).toBeUndefined();
  expect(nextAttempt(preparing, { type: "unlock" })).toBeUndefined();
  expect(run([review("market"), { type: "approval" }, { type: "submission" }])).toEqual({ phase: "submitting", order: "market" });
  expect(run([review("market"), { type: "approval" }, { type: "submission" }, { type: "settle" }])).toEqual(IDLE);
});

it.each(["market", "limit"] as const)("keeps a %s order with an unknown outcome from every further order", order => {
  const uncertain = run([review(order), { type: "approval" }, { type: "submission" }, { type: "lost" }, { type: "settle" }]);
  expect(uncertain).toEqual({ phase: "uncertain", order });
  for (const event of everyEvent) if (event.type !== "unlock") expect(nextAttempt(uncertain, event)).toBeUndefined();
  // Confirming balance access interrupts it and hands it back.
  expect(run([{ type: "unlock" }, { type: "settle" }], uncertain)).toEqual(uncertain);
});

it("treats a limit approval that failed to return as unknown, since ID may have funded the order", () => {
  expect(run([review("limit"), { type: "approval" }, { type: "lost" }, { type: "settle" }])).toEqual({ phase: "uncertain", order: "limit" });
});

it("holds an unconfirmed cancellation until a retry confirms it", () => {
  const failed = run([review("limit"), { type: "approval" }, { type: "abandon", requestId: "request" }, { type: "abandonFailed" }, { type: "settle" }]);
  expect(failed).toEqual({ phase: "abandonFailed", requestId: "request" });
  for (const event of everyEvent) if (event.type !== "retryAbandon") expect(nextAttempt(failed, event)).toBeUndefined();
  expect(run([{ type: "retryAbandon" }, { type: "abandonFailed" }, { type: "settle" }], failed)).toEqual(failed);
  expect(run([{ type: "retryAbandon" }, { type: "settle" }], failed)).toEqual(IDLE);
});

it("abandons only limit orders, and only before they are funded", () => {
  expect(nextAttempt(run([review("market"), { type: "approval" }]), { type: "abandon", requestId: "request" })).toBeUndefined();
  expect(nextAttempt(run([review("limit"), { type: "approval" }, { type: "submission" }]), { type: "abandon", requestId: "request" })).toBeUndefined();
  expect(run([review("limit"), { type: "abandon", requestId: "request" }, { type: "settle" }])).toEqual(IDLE);
});

it("locks the draft while anything is unsettled, except after a market order's unknown outcome", () => {
  const states: [Attempt, busy: boolean, locked: boolean][] = [
    [IDLE, false, false],
    [{ phase: "unlocking", resume: IDLE }, true, true],
    [{ phase: "preparing", order: "market", reusesQuote: true }, true, true],
    [{ phase: "confirming", order: "limit" }, true, true],
    [{ phase: "submitting", order: "market" }, true, true],
    [{ phase: "abandoning", requestId: "request" }, true, true],
    [{ phase: "abandonFailed", requestId: "request" }, false, true],
    [{ phase: "uncertain", order: "limit" }, false, true],
    [{ phase: "uncertain", order: "market" }, false, false],
  ];
  for (const [state, busy, locked] of states) expect([state.phase, attemptBusy(state), draftLocked(state)]).toEqual([state.phase, busy, locked]);
});
