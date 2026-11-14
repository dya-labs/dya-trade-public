"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { D } from "@dya/wallet-contracts/src/domain/decimal";
import type { ExactDepositSource } from "@dya/wallet-ui/components/near/transfers";
import { createTradingDeposit, readTradingDepositStatus } from "../lib/outlayer-client";

const depositStates = { pending: "PENDING_DEPOSIT", bridging: "PROCESSING", success: "SUCCESS", failed: "FAILED", expired: "FAILED" };

export function useTradingDeposit(walletId: string): ExactDepositSource {
  const client = useQueryClient();
  return useMemo(() => {
    return {
      async prepare(amount: string) {
        const intent = await createTradingDeposit(walletId, new D(amount).mul(1_000_000).toFixed(0));
        return {
          id: intent.intent_id, deadline: intent.expires_at, depositAddress: intent.deposit_address,
          depositMemo: null, asset: "USDC", sourceChain: "Base", sourceNetwork: "base", amountInFormatted: amount,
        };
      },
      async readStatus(id: string, signal: AbortSignal) {
        const status = await readTradingDepositStatus(walletId, id, signal);
        return { status: depositStates[status], terminal: status === "success" || status === "failed" || status === "expired" };
      },
      onSettled() {
        void client.invalidateQueries({ queryKey: ["id", "trading-token-balances", walletId] });
        void client.invalidateQueries({ queryKey: ["id", "trading-activity", walletId] });
      },
    };
  }, [client, walletId]);
}
