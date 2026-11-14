import { expect, it } from "vitest";
import { ticketAction, type TicketActionInputs } from "@/components/near/ticket-action";
import { IDLE } from "@/components/near/ticket-attempt";

/** A connected ticket with a valid, quoted, affordable draft: the button reads Review. */
const ready: TicketActionInputs = { attempt: IDLE, restoring: false, paused: false, feeUnverified: false, connected: true, accessRequired: false, balanceUnavailable: false, retryingBalance: false, quotePending: false, sliding: false, quoteFailed: false, insufficient: false, draftValid: true };
const action = (input: Partial<TicketActionInputs>) => { const { kind, label, disabled } = ticketAction({ ...ready, ...input }); return [kind, label, disabled]; };

it("offers Review only for a valid draft with a usable quote", () => {
  expect(action({})).toEqual(["review", "Review", false]);
  expect(action({ draftValid: false })).toEqual(["review", "Review", true]);
  expect(action({ quotePending: true })).toEqual(["awaitQuote", "Getting quote…", true]);
  expect(action({ quotePending: true, sliding: true })).toEqual(["awaitQuote", "Release to quote", true]);
  expect(action({ quoteFailed: true })).toEqual(["retryQuote", "Try again", false]);
  expect(action({ insufficient: true })).toEqual(["insufficient", "Insufficient balance", true]);
  expect(action({ restoring: true })).toEqual(["review", "Review", true]);
});

it("names each step of an order under way, whatever else changes meanwhile", () => {
  const meanwhile = { accessRequired: true, balanceUnavailable: true, quotePending: true };
  expect(action({ ...meanwhile, attempt: { phase: "preparing", order: "market", reusesQuote: true } })).toEqual(["progress", "Opening review…", true]);
  expect(action({ ...meanwhile, attempt: { phase: "preparing", order: "market", reusesQuote: false } })).toEqual(["progress", "Getting quote…", true]);
  expect(action({ ...meanwhile, attempt: { phase: "preparing", order: "limit", reusesQuote: false } })).toEqual(["progress", "Preparing order…", true]);
  expect(action({ ...meanwhile, attempt: { phase: "confirming", order: "market" } })).toEqual(["progress", "Waiting for confirmation…", true]);
  expect(action({ ...meanwhile, attempt: { phase: "submitting", order: "market" } })).toEqual(["progress", "Submitting…", true]);
  expect(action({ ...meanwhile, attempt: { phase: "submitting", order: "limit" } })).toEqual(["progress", "Submitting…", true]);
  expect(action({ ...meanwhile, attempt: { phase: "abandoning", requestId: "request" } })).toEqual(["progress", "Cancelling…", true]);
  expect(action({ ...meanwhile, attempt: { phase: "unlocking", resume: IDLE } })).toEqual(["progress", "Confirming…", true]);
});

it("keeps an unconfirmed cancellation the next step even when balance access has expired", () => {
  expect(action({ attempt: { phase: "abandonFailed", requestId: "request" }, accessRequired: true })).toEqual(["retryAbandonment", "Retry cancellation", false]);
});

it("sends an unknown outcome to history, after access and balances are restored", () => {
  expect(action({ attempt: { phase: "uncertain", order: "market" } })).toEqual(["checkHistory", "Check My trades", true]);
  expect(action({ attempt: { phase: "uncertain", order: "limit" } })).toEqual(["checkHistory", "Check Orders", true]);
  expect(action({ attempt: { phase: "uncertain", order: "market" }, balanceUnavailable: true })).toEqual(["retryBalance", "Retry balance", false]);
  expect(action({ attempt: { phase: "uncertain", order: "limit" }, accessRequired: true })).toEqual(["unlock", "Continue with passkey", false]);
});

it("pauses new orders during an outage or an unverified fee, never an order under way", () => {
  expect(action({ paused: true })).toEqual(["unavailable", "Trading unavailable", true]);
  expect(action({ feeUnverified: true })).toEqual(["unavailable", "Trading unavailable", true]);
  expect(action({ feeUnverified: true, attempt: { phase: "uncertain", order: "market" } })).toEqual(["checkHistory", "Check My trades", true]);
});

it("asks a signed-out or locked account for the step that unblocks it", () => {
  expect(action({ connected: false })).toEqual(["signIn", "Sign in", false]);
  expect(action({ connected: false, restoring: true })).toEqual(["signIn", "Review", true]);
  expect(action({ accessRequired: true, draftValid: false })).toEqual(["unlock", "Continue with passkey", false]);
  expect(action({ balanceUnavailable: true, draftValid: false })).toEqual(["retryBalance", "Retry balance", false]);
  expect(action({ balanceUnavailable: true, retryingBalance: true })).toEqual(["retryBalance", "Retrying…", true]);
});
