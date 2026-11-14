/**
 * Chain-neutral configuration consumed by the terminal UI.
 *
 * Protocol code stays in lib/near; adding another chain should provide another
 * adapter here instead of changing the chart, ticket, or order views.
 */
export type ChainId = "near";

export type TerminalAsset = {
  symbol: string;
  displayName: string;
  tokenMark: "near" | "usdc";
};

export type TerminalPair = {
  id: string;
  chainId: ChainId;
  chainLabel: string;
  networkLabel: string;
  base: TerminalAsset;
  quote: TerminalAsset;
  executionLabel: string;
};

export const TERMINAL_PAIR: TerminalPair = {
  id: "near-usdc",
  chainId: "near",
  chainLabel: "NEAR",
  networkLabel: "NEAR mainnet",
  base: { symbol: "NEAR", displayName: "Wrapped NEAR", tokenMark: "near" },
  quote: { symbol: "USDC", displayName: "USD Coin", tokenMark: "usdc" },
  executionLabel: "NEAR Intents",
};
