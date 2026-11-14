import type { DepositItem } from "../http/schemas/transfers";

export function isAwaitingDeposit(deposit: Pick<DepositItem, "status" | "originChainTxHashes" | "destinationChainTxHashes">) {
  return deposit.status === "PENDING_DEPOSIT" &&
    !deposit.originChainTxHashes?.length && !deposit.destinationChainTxHashes?.length;
}

export function depositStatusLabel(status: string) {
  switch (status) {
    case "PENDING_DEPOSIT": return "Awaiting deposit";
    case "KNOWN_DEPOSIT_TX": return "Deposit detected";
    case "INCOMPLETE_DEPOSIT": return "Incomplete deposit";
    case "PROCESSING": return "Processing";
    case "SUCCESS": return "Completed";
    case "REFUNDED": return "Refunded";
    case "FAILED": return "Failed";
    default: return "Checking";
  }
}
