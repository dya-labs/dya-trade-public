// @vitest-environment node
import { setTimeout as sleep } from "node:timers/promises";
import { QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { createQueryClient, syncTabs } from "@/components/query-provider";
import { RateLimitError } from "@/lib/near/domain/rate-limit";

const SESSION = ["near", "session"];
const ORDERS = ["near", "account", "a", "orders", "confidential"];
const snapshot = (id: string | null) => ({ account: id ? { id, kind: "passkey" } : null, passkeyOrigin: "https://id.example.test" });
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function tab() {
  const client = createQueryClient();
  const state = { session: snapshot("a"), sessionFetches: 0, orderFetches: 0 };
  const observers = [
    new QueryObserver(client, { queryKey: SESSION, queryFn: async () => { state.sessionFetches++; return state.session; }, staleTime: Infinity }),
    new QueryObserver(client, { queryKey: ORDERS, queryFn: async () => { state.orderFetches++; return []; }, staleTime: Infinity }),
  ];
  const unsubscribes = observers.map(observer => observer.subscribe(() => {}));
  const stop = syncTabs(client);
  cleanups.push(() => { stop(); for (const unsubscribe of unsubscribes) unsubscribe(); client.clear(); });
  // A refetch while the first fetch is in flight joins it, so tests start from loaded tabs.
  const loaded = () => vi.waitFor(() => expect([SESSION, ORDERS].map(key => client.getQueryState(key)?.status)).toEqual(["success", "success"]));
  return { client, state, loaded };
}

it("tells other tabs about a session account change at once, without echoing it back", async () => {
  const a = tab(), b = tab();
  await Promise.all([a.loaded(), b.loaded()]);
  a.state.session = b.state.session = snapshot(null);
  await a.client.refetchQueries({ queryKey: SESSION });
  await vi.waitFor(() => expect(b.state.sessionFetches).toBe(2));
  await sleep(50);
  expect([a.state.sessionFetches, b.state.sessionFetches]).toEqual([2, 2]);
});

it("shares account invalidations from a tab's own actions, but not its polls", async () => {
  const a = tab(), b = tab();
  await Promise.all([a.loaded(), b.loaded()]);
  await a.client.refetchQueries({ queryKey: ["near", "account"] });
  await sleep(50);
  expect(b.state.orderFetches).toBe(1);
  await a.client.invalidateQueries({ queryKey: ["near", "account", "a"] });
  await vi.waitFor(() => expect(b.state.orderFetches).toBe(2));
  await sleep(50);
  expect([a.state.orderFetches, b.state.orderFetches]).toEqual([3, 2]);
});

it("rechecks the session when an account request fails, except when rate limited", async () => {
  const client = createQueryClient();
  let sessionFetches = 0;
  const session = new QueryObserver(client, { queryKey: SESSION, queryFn: async () => { sessionFetches++; return snapshot("a"); }, staleTime: Infinity });
  cleanups.push(session.subscribe(() => {}), () => client.clear());
  await vi.waitFor(() => expect(sessionFetches).toBe(1));
  await expect(client.fetchQuery({ queryKey: ["near", "account", "a", "balances"], queryFn: async () => { throw new RateLimitError(Date.now() + 1000); }, retry: false })).rejects.toThrow();
  await sleep(50);
  expect(sessionFetches).toBe(1);
  await expect(client.fetchQuery({ queryKey: ORDERS, queryFn: async () => { throw new Error("Sign in with a passkey first."); }, retry: false })).rejects.toThrow();
  await vi.waitFor(() => expect(sessionFetches).toBe(2));
});
