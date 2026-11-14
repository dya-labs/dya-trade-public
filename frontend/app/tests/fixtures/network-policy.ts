import type { Network } from "../../../../packages/wallet-contracts/src/domain/networks";
// Synthetic policy for UI tests. Never used by production discovery or approval.
export const approvedTestNetworks: Network[] = Object.entries({ near: "NEAR", bsc: "BNB Smart Chain", base: "Base", eth: "Ethereum", sol: "Solana", arb: "Arbitrum", hood: "Robinhood" }).map(([id,name]) => ({ id, name, iconUrl: "", explorerUrl: "", evmChainId: null, addressKind: "provider", status: "approved", deposits: true, withdrawals: true, discoveredAt: 0, updatedAt: 0, revision: 0 }));
