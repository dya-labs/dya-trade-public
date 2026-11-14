"use client";
import { ArrowRight } from "@dya/ui/icons";
import { NetworkMark } from "./network-mark";

const aliases: Record<string, string> = {
  ethereum: "eth", "bnb smart chain": "bsc", "binance smart chain": "bsc",
  "near intents": "near", solana: "sol", arbitrum: "arb", optimism: "op",
  "op mainnet": "op", polygon: "pol", avalanche: "avax", berachain: "bera", bitcoin: "btc",
  robinhood: "hood", "robinhood chain": "hood",
};
const networkKey = (name: string) => aliases[name.toLowerCase()] ?? name.toLowerCase();

/** Compact route presentation; original route names remain available to assistive technology and on hover. */
export function ChainsPath({ from, to, labelSide }: { from: string; to: string; labelSide?: "from" | "to" }) {
  const label = `${from} → ${to}`;
  return <span className="inline-flex items-center gap-2 align-middle" role="img" aria-label={`${from} to ${to}`} title={label}>
    <span className="inline-flex items-center gap-1.5"><NetworkMark network={networkKey(from)} size={16} />{labelSide === "from" && <span>{from}</span>}</span>
    <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
    <span className="inline-flex items-center gap-1.5"><NetworkMark network={networkKey(to)} size={16} />{labelSide === "to" && <span>{to}</span>}</span>
  </span>;
}
