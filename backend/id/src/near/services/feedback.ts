import { feedbackInputSchema } from "../../../../../packages/wallet-contracts/src/domain/feedback";
import { accountFor, type StateStore } from "../repositories/store";

export async function submitFeedback(store: StateStore, session: string | undefined, input: unknown, now = Date.now()) {
  const body = feedbackInputSchema.safeParse(input);
  if (!body.success) return { status: 400, body: { error: "Enter feedback between 3 and 2,000 characters." } };
  return store.transaction(s => {
    const account = accountFor(s, session, now);
    if (!account) return { status: 401, body: { error: "Sign in to send feedback." } };
    const map = s.accessRecords ??= {}, id = `feedback:${body.data.id}`, previous = map[id];
    if (previous) {
      if (previous.kind === "feedback" && previous.accountId === account.id && previous.message === body.data.message) return { status: 200, body: { ok: true } };
      return { status: 409, body: { error: "Please reopen the form and try again." } };
    }
    const recent = Object.values(map).filter(r => r.kind === "feedback" && r.accountId === account.id && r.createdAt > now - 3600000);
    if (recent.length >= 5) return { status: 429, body: { error: "Feedback limit reached. Please try again in an hour." } };
    map[id] = { kind: "feedback", id, accountId: account.id, message: body.data.message, createdAt: now };
    return { status: 201, body: { ok: true } };
  });
}
