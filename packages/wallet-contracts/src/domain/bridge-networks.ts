const NETWORKS: Record<string, string> = {
  "eth:1": "eth", "eth:10": "op", "eth:100": "gnosis", "eth:137": "pol",
  "eth:143": "monad", "eth:196": "xlayer", "eth:42161": "arb", "eth:43114": "avax",
  "eth:56": "bsc", "eth:8453": "base", "eth:534352": "scroll",
  "eth:80094": "bera", "eth:9745": "plasma",
  "eth:4663": "hood",
};
export function networkFor(chain: string) { return NETWORKS[chain] ?? (chain.endsWith(":mainnet") ? chain.split(":")[0] : undefined); }
