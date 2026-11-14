export type OrderKind = "market" | "limit";

/** Where an attempt rests between pieces of work. `uncertain`: the outcome is unknown and history decides; nothing leaves it, so the ticket places no further order. */
type Resting = { phase: "idle" } | { phase: "uncertain"; order: OrderKind };

/** What the ticket is doing with the order it is placing, from Review until the outcome is known. */
export type Attempt =
  | Resting
  /** Balance access is being confirmed with the passkey; `resume` is the state it interrupted. */
  | { phase: "unlocking"; resume: Resting }
  /** The order is being prepared. A market order with a stored quote (`reusesQuote`) only opens its review. */
  | { phase: "preparing"; order: OrderKind; reusesQuote: boolean }
  /** DYA ID is open for approval. */
  | { phase: "confirming"; order: OrderKind }
  /** Approved: the order is on its way and may already be placed. */
  | { phase: "submitting"; order: OrderKind }
  /** A prepared limit order that was not funded is being cancelled at the provider. */
  | { phase: "abandoning"; requestId: string }
  /** That cancellation did not confirm. Only a retry leaves this state. */
  | { phase: "abandonFailed"; requestId: string }
  /** The outcome is unknown and history decides. Nothing leaves this state: the ticket places no further order. */
  | { phase: "uncertain"; order: OrderKind };

export type AttemptEvent =
  | { type: "unlock" }
  | { type: "review"; order: OrderKind; reusesQuote: boolean }
  /** The order is prepared and DYA ID opens. */
  | { type: "approval" }
  /** The approval returned and the order is being submitted. */
  | { type: "submission" }
  | { type: "abandon"; requestId: string }
  | { type: "abandonFailed" }
  | { type: "retryAbandon" }
  /** The submission's outcome could not be learned. */
  | { type: "lost" }
  /** The work under way ended: cancelled, failed before anything was submitted, or done. */
  | { type: "settle" };

export const IDLE = { phase: "idle" } as const satisfies Attempt;

/** The only place an attempt changes phase. `undefined`: the state does not accept the event. */
export function nextAttempt(state: Attempt, event: AttemptEvent): Attempt | undefined {
  switch (event.type) {
    case "unlock": return state.phase === "idle" || state.phase === "uncertain" ? { phase: "unlocking", resume: state } : undefined;
    case "review": return state.phase === "idle" ? { phase: "preparing", order: event.order, reusesQuote: event.reusesQuote } : undefined;
    case "approval": return state.phase === "preparing" ? { phase: "confirming", order: state.order } : undefined;
    case "submission": return state.phase === "confirming" ? { phase: "submitting", order: state.order } : undefined;
    // Only a limit order holds something at the provider before it is funded.
    case "abandon": return (state.phase === "preparing" || state.phase === "confirming") && state.order === "limit" ? { phase: "abandoning", requestId: event.requestId } : undefined;
    case "abandonFailed": return state.phase === "abandoning" ? { phase: "abandonFailed", requestId: state.requestId } : undefined;
    case "retryAbandon": return state.phase === "abandonFailed" ? { phase: "abandoning", requestId: state.requestId } : undefined;
    case "lost": return state.phase === "confirming" || state.phase === "submitting" ? { phase: "uncertain", order: state.order } : undefined;
    case "settle":
      if (state.phase === "unlocking") return state.resume;
      return state.phase === "idle" || state.phase === "abandonFailed" || state.phase === "uncertain" ? undefined : IDLE;
  }
}

/** Work is under way and its result is awaited. */
export function attemptBusy(attempt: Attempt) {
  return attempt.phase !== "idle" && attempt.phase !== "abandonFailed" && attempt.phase !== "uncertain";
}

/**
 * The draft cannot be edited: work is under way, a cancellation is unconfirmed, or a limit order's
 * funding is unknown. A market order's unknown outcome leaves the draft editable.
 */
export function draftLocked(attempt: Attempt) {
  return attempt.phase !== "idle" && !(attempt.phase === "uncertain" && attempt.order === "market");
}
