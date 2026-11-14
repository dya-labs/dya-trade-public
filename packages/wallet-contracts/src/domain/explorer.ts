const EVM_TRANSACTION_EXPLORERS = {
    eth: "https://etherscan.io/tx/", ethereum: "https://etherscan.io/tx/", "eth:1": "https://etherscan.io/tx/",
    base: "https://basescan.org/tx/", "eth:8453": "https://basescan.org/tx/",
    bsc: "https://bscscan.com/tx/", "bnb smart chain": "https://bscscan.com/tx/", "eth:56": "https://bscscan.com/tx/",
    arb: "https://arbiscan.io/tx/", arbitrum: "https://arbiscan.io/tx/", "eth:42161": "https://arbiscan.io/tx/",
    op: "https://optimistic.etherscan.io/tx/", optimism: "https://optimistic.etherscan.io/tx/", "eth:10": "https://optimistic.etherscan.io/tx/",
    pol: "https://polygonscan.com/tx/", polygon: "https://polygonscan.com/tx/", "eth:137": "https://polygonscan.com/tx/",
  } as Record<string, string>;

/** A NEAR transaction hash is base58; provider order/fill/intent IDs are not tx hashes. */
export function nearTransactionUrl(hash: string): string | null {
  return /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash)
    ? `https://nearblocks.io/txns/${hash}`
    : null;
}

/** Only EVM transaction hashes may become BscScan transaction links. */
export function bscTransactionUrl(hash: string): string | null {
  return /^0x[0-9a-fA-F]{64}$/.test(hash)
    ? `https://bscscan.com/tx/${hash}`
    : null;
}

export function bscAddressUrl(address: string): string | null {
  return /^0x[0-9a-fA-F]{40}$/.test(address)
    ? `https://bscscan.com/address/${address}`
    : null;
}

/** Explorer destinations are fixed and hashes are validated before building links. Unknown networks remain plain text. */
export function transactionExplorerUrl(network: string, hash: string): string | null {
  const chain = network.toLowerCase();
  if (["near", "near intents", "near:mainnet"].includes(chain)) return nearTransactionUrl(hash);
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  const explorer = EVM_TRANSACTION_EXPLORERS[chain];
  return explorer ? `${explorer}${hash}` : null;
}

/** The supplied address must belong to this network; never infer a sender from a refund address. */
export function addressExplorerUrl(network: string, address: string): string | null {
  const chain = network.toLowerCase();
  if (["near", "near intents", "near:mainnet"].includes(chain)) {
    return address.length >= 2 && address.length <= 64 && /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(address)
      ? `https://nearblocks.io/address/${address}` : null;
  }
  const explorer = EVM_TRANSACTION_EXPLORERS[chain];
  return explorer && /^0x[0-9a-fA-F]{40}$/.test(address) ? `${explorer.replace(/\/tx\/$/, "/address/")}${address}` : null;
}
