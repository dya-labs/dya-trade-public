export type AccessRecord =
  | import("./feedback").FeedbackRecord
  | { kind: "fee-setting"; id: string; policy: import("./trading-fees").TradingFeePolicy; updatedAt: number; updatedBy: string }
  | { kind: "refund-setting"; id: string; networkId: string; chainId?: number; addressKind?: "evm" | "near" | "provider"; address: string; revision: number; updatedAt: number; updatedBy: string };
