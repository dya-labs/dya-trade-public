import type { Attempt } from "./ticket-attempt";

/** What the ticket's one button does. Kinds without a handler in the ticket are never clickable. */
export type TicketActionKind = "unavailable" | "progress" | "retryAbandonment" | "signIn" | "unlock" | "retryBalance" | "checkHistory" | "awaitQuote" | "retryQuote" | "insufficient" | "review";
export type TicketAction = { kind: TicketActionKind; label: string; disabled: boolean; spinner: boolean };

export type TicketActionInputs = {
  attempt: Attempt;
  /** The last opened market is being restored. */
  restoring: boolean;
  /** New orders are paused by an upstream outage. */
  paused: boolean;
  feeUnverified: boolean;
  connected: boolean;
  accessRequired: boolean;
  balanceUnavailable: boolean;
  retryingBalance: boolean;
  quotePending: boolean;
  sliding: boolean;
  quoteFailed: boolean;
  insufficient: boolean;
  /** The size, and for a limit order the price, can be reviewed. */
  draftValid: boolean;
};

/**
 * The button's label, whether it can be clicked, and what a click does, decided together so they
 * cannot disagree. The first matching row wins.
 */
export function ticketAction(input: TicketActionInputs): TicketAction {
  const { attempt } = input;
  // Nothing is clickable while the market is restored or a balance retry runs.
  const waiting = input.restoring || input.retryingBalance;
  const progress = (label: string): TicketAction => ({ kind: "progress", label, disabled: true, spinner: true });
  if (input.paused || (input.feeUnverified && attempt.phase === "idle")) return { kind: "unavailable", label: "Trading unavailable", disabled: true, spinner: false };
  switch (attempt.phase) {
    case "unlocking": return progress("Confirming…");
    case "preparing": return progress(attempt.order === "limit" ? "Preparing order…" : attempt.reusesQuote ? "Opening review…" : "Getting quote…");
    case "confirming": return progress("Waiting for confirmation…");
    case "submitting": return progress("Submitting…");
    case "abandoning": return progress("Cancelling…");
    case "abandonFailed": return { kind: "retryAbandonment", label: "Retry cancellation", disabled: waiting, spinner: false };
    case "idle": case "uncertain": break;
  }
  if (!input.connected) return { kind: "signIn", label: input.restoring ? "Review" : "Sign in", disabled: waiting, spinner: false };
  if (input.accessRequired) return { kind: "unlock", label: "Continue with passkey", disabled: waiting, spinner: false };
  if (input.balanceUnavailable || input.retryingBalance) return { kind: "retryBalance", label: input.retryingBalance ? "Retrying…" : "Retry balance", disabled: waiting, spinner: input.retryingBalance };
  if (attempt.phase === "uncertain") return { kind: "checkHistory", label: attempt.order === "limit" ? "Check Orders" : "Check My trades", disabled: true, spinner: false };
  if (input.quotePending) return { kind: "awaitQuote", label: input.sliding ? "Release to quote" : "Getting quote…", disabled: true, spinner: !input.sliding };
  if (input.quoteFailed) return { kind: "retryQuote", label: "Try again", disabled: waiting || !input.draftValid, spinner: false };
  if (input.insufficient) return { kind: "insufficient", label: "Insufficient balance", disabled: true, spinner: false };
  return { kind: "review", label: "Review", disabled: waiting || !input.draftValid, spinner: false };
}
