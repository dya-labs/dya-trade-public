// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { submitFeedback } from "../../../backend/id/src/near/services/feedback";
import { Store } from "../../../backend/id/src/near/repositories/sqlite-store";
import { hash } from "../../../backend/id/src/near/repositories/store";
import { validateRecord } from "../../../backend/id/src/near/repositories/d1-records";
let store: Store;
const now = Date.now();
beforeEach(() => {
  store = new Store(":memory:");
  store.transaction(s => {
    s.accounts.user = { id: "user", kind: "passkey" };
    s.sessions[hash("session")] = { accountId: "user", expires: now + 7200000 };
  });
});
afterEach(() => store.close());
const input = () => ({ id: randomUUID(), message: "Please improve the chart controls." });
it("requires a live session", async () => {
  expect((await submitFeedback(store, undefined, input(), now)).status).toBe(401);
  expect((await submitFeedback(store, "expired", input(), now)).status).toBe(401);
});
it("rejects empty, oversized, and identity-injection payloads", async () => {
  for (const body of [{ ...input(), message: "  " }, { ...input(), message: "x".repeat(2001) }, { ...input(), accountId: "another-user" }]) expect((await submitFeedback(store, "session", body, now)).status).toBe(400);
});
it("persists the message with the server-owned account and supports safe retries", async () => {
  const body = { ...input(), message: "  <script>untrusted text</script>  " };
  expect((await submitFeedback(store, "session", body, now)).status).toBe(201);
  expect((await submitFeedback(store, "session", body, now)).status).toBe(200);
  expect((await submitFeedback(store, "session", { ...body, message: "changed" }, now)).status).toBe(409);
  const saved = store.read(s => s.accessRecords![`feedback:${body.id}`]);
  expect(saved).toMatchObject({ accountId: "user", message: body.message.trim(), createdAt: now });
  expect(validateRecord("accessRecords", saved.id, saved)).toEqual(saved);
  expect(() => validateRecord("accessRecords", saved.id, { ...saved, message: "x".repeat(2001) })).toThrow();
});
it("limits new submissions per account without blocking an idempotent retry", async () => {
  const first = input();
  for (const body of [first, ...Array.from({ length: 4 }, input)]) expect((await submitFeedback(store, "session", body, now)).status).toBe(201);
  expect((await submitFeedback(store, "session", input(), now)).status).toBe(429);
  expect((await submitFeedback(store, "session", first, now)).status).toBe(200);
  expect((await submitFeedback(store, "session", input(), now + 3600001)).status).toBe(201);
});
it("accepts same-origin HTTP submissions and rejects cross-origin posts", async () => {
  const { handleNear } = await import("../../../backend/id/src/near/http/api");
  const { NextRequest } = await import("next/server");
  vi.stubEnv("APP_ORIGIN", "http://localhost:3100");
  const make = (origin: string) => new NextRequest("http://localhost:3100/api/near/feedback", { method: "POST", headers: { origin, "content-type": "application/json", cookie: "near_session=session" }, body: JSON.stringify(input()) });
  try {
    expect((await handleNear(make("https://other.example"), ["feedback"], store)).status).toBe(403);
    const response = await handleNear(make("http://localhost:3100"), ["feedback"], store);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
  } finally { vi.unstubAllEnvs(); }
});
