"use client";
import type { Snapshot } from "@/lib/near/http/schemas/account";
import { fetchWalletSession } from "@dya/wallet-ui/hooks/use-wallet-queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export function useTerminalData() {
  const client = useQueryClient();
  // This tab's own sign-in/out sets or refreshes the session directly, and other tabs hear of it through
  // QueryProvider's channel; the poll and focus refetch only catch other devices and the ID site.
  const session = useQuery({ queryKey: ["near", "session"], queryFn: fetchWalletSession, refetchInterval: 60_000, staleTime: 2_000 });
  return {
    session,
    refreshSession: async () => { await client.invalidateQueries({ queryKey: ["near", "session"] }); },
    // A poll that started before the change would overwrite the new session with the old one.
    setSession: async (value: Snapshot) => { await client.cancelQueries({ queryKey: ["near", "session"] }); client.setQueryData(["near", "session"], value); },
    clearAccount: () => { client.removeQueries({ queryKey: ["near", "account"] }); },
  };
}
