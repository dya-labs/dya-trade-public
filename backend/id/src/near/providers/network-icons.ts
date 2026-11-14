// Stable chain identity metadata from CoinGecko asset_platforms, verified 2026-10-04.
// Keep display assets independent of runtime API rate limits and server cache support.
// Source: https://api.coingecko.com/api/v3/asset_platforms
const networkIcons: Readonly<Record<string, string>> = Object.freeze({
  // CoinGecko robinhood platform (EVM chain 4663), verified 2026-10-31.
  "hood": "https://coin-images.coingecko.com/asset_platforms/images/102132299/small/robinhood.png?1782921203",
  "eth": "https://coin-images.coingecko.com/asset_platforms/images/279/small/ethereum.png?1706606803",
  "bsc": "https://coin-images.coingecko.com/asset_platforms/images/1/small/bnb_smart_chain.png?1706606721",
  "sol": "https://coin-images.coingecko.com/asset_platforms/images/5/small/solana.png?1706606708",
  "near": "https://coin-images.coingecko.com/asset_platforms/images/34/small/near.jpeg?1706870535",
  "arb": "https://coin-images.coingecko.com/asset_platforms/images/33/small/AO_logomark.png?1706606717",
  "base": "https://coin-images.coingecko.com/asset_platforms/images/131/small/base.png?1759905869",
  "op": "https://coin-images.coingecko.com/asset_platforms/images/41/small/optimism.png?1706606778",
  "pol": "https://coin-images.coingecko.com/asset_platforms/images/15/small/polygon_pos.png?1706606645",
  "avax": "https://coin-images.coingecko.com/asset_platforms/images/12/small/avalanche.png?1706606775",
  "gnosis": "https://coin-images.coingecko.com/asset_platforms/images/11062/small/Aatar_green_white.png?1706606458",
  "aptos": "https://coin-images.coingecko.com/asset_platforms/images/116/small/aptos_round.png?1706606789",
  "sui": "https://coin-images.coingecko.com/asset_platforms/images/126/small/sui-ocean-square.png?1727791325",
  "stellar": "https://coin-images.coingecko.com/asset_platforms/images/100/small/stellar.jpeg?1708492494",
  "bera": "https://coin-images.coingecko.com/asset_platforms/images/176/small/berachain.jpeg?1706606828",
  "berachain": "https://coin-images.coingecko.com/asset_platforms/images/176/small/berachain.jpeg?1706606828",
  "ton": "https://coin-images.coingecko.com/asset_platforms/images/142/small/tonblockchain.jpeg?1706606805",
  "tron": "https://coin-images.coingecko.com/asset_platforms/images/1094/small/TRON_LOGO.png?1706606652",
  "monad": "https://coin-images.coingecko.com/asset_platforms/images/22182/small/monad.png?1729046263",
  "xlayer": "https://coin-images.coingecko.com/asset_platforms/images/238/small/x_logo.jpeg?1713243242"
});

export async function readNetworkIcons(): Promise<Record<string, string>> {
  return { ...networkIcons };
}
