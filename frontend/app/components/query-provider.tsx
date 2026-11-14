"use client";
import { useEffect, useState, type ReactNode } from "react";
import { QueryCache, QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { z } from "zod";
import { RateLimitError } from "@/lib/near/domain/rate-limit";
import { snapshot } from "@/lib/near/http/schemas/account";

const SESSION: QueryKey = ["near", "session"];
const message = z.object({ key: z.tuple([z.literal("near")], z.unknown()) });

/**
 * Tabs of this browser tell each other about account changes, so a sign-in, sign-out, order or
 * withdrawal in one tab shows in the others at once instead of at their next (slow) poll.
 * Announced: a changed session account, and invalidated account queries (what this tab does after
 * its own actions). Plain polls are not announced, and a tab never re-announces what it heard.
 */
export function syncTabs(client: QueryClient): () => void {
  const channel = new BroadcastChannel("dya-terminal-queries");
  const heard = new Set<string>();
  let account: string | null | undefined;
  channel.onmessage = ({ data }: MessageEvent<unknown>) => {
    const parsed = message.safeParse(data);
    if (!parsed.success) return;
    for (const query of client.getQueryCache().findAll({ queryKey: parsed.data.key })) heard.add(query.queryHash);
    void client.invalidateQueries({ queryKey: parsed.data.key });
  };
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.type !== "updated") return;
    const { query, action } = event;
    if (query.queryKey[0] !== "near") return;
    if (query.queryKey[1] === "account" && action.type === "invalidate") {
      if (!heard.delete(query.queryHash)) channel.postMessage({ key: query.queryKey });
    } else if (query.queryKey[1] === "session" && action.type === "success") {
      const session = snapshot.safeParse(action.data);
      const next = session.success ? session.data.account?.id ?? null : null;
      const changed = account !== undefined && next !== account;
      account = next;
      if (!heard.delete(query.queryHash) && changed) channel.postMessage({ key: SESSION });
    }
  });
  return () => { unsubscribe(); channel.close(); };
}

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    // A failing account request can mean the session ended elsewhere (another device, the ID site):
    // recheck it now rather than at the next session poll. Rate limits are not session problems.
    queryCache: new QueryCache({ onError: (error, query) => {
      if (query.queryKey[0] === "near" && query.queryKey[1] === "account" && !(error instanceof RateLimitError)) void client.invalidateQueries({ queryKey: SESSION }, { cancelRefetch: false });
    } }),
    defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true, refetchOnReconnect: true }, mutations: { retry: false } },
  });
  return client;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  useEffect(() => typeof BroadcastChannel === "undefined" ? undefined : syncTabs(client), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
