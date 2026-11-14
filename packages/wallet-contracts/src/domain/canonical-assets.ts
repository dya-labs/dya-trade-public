import { DEFAULT_PAIR, type CatalogAsset } from "./catalog";

// Explicit terminal listings, not symbol-based deduplication. IDs are taken from
// the 1Click catalog. Missing or changed listings fail closed; never fall back
// to another representation sharing the same symbol. Distinct derivatives and
// ambiguous identities are separate listings, even when symbols overlap.
const listings = [
  {"symbol": "wNEAR", "blockchain": "near", "assetId": "nep141:wrap.near"},
  {"symbol": "SOL", "blockchain": "sol", "assetId": "nep141:sol.omft.near"},
  {"symbol": "ETH", "blockchain": "eth", "assetId": "nep141:eth.omft.near"},
  {"symbol": "BTC", "blockchain": "near", "assetId": "nep141:nbtc.bridge.near"},
  {"symbol": "SUI", "blockchain": "sui", "assetId": "nep141:sui.omft.near"},
  {"symbol": "DOGE", "blockchain": "doge", "assetId": "nep141:doge.omft.near"},
  {"symbol": "XRP", "blockchain": "xrp", "assetId": "nep141:xrp.omft.near"},
  {"symbol": "ZEC", "blockchain": "zec", "assetId": "nep141:zec.omft.near"},
  {"symbol": "LTC", "blockchain": "ltc", "assetId": "nep141:ltc.omft.near"},
  {"symbol": "BCH", "blockchain": "bch", "assetId": "nep141:bch.omft.near"},
  {"symbol": "ADA", "blockchain": "cardano", "assetId": "nep141:cardano.omft.near"},
  {"symbol": "APT", "blockchain": "aptos", "assetId": "nep141:aptos.omft.near"},
  {"symbol": "AVAX", "blockchain": "avax", "assetId": "nep245:v2_1.omni.hot.tg:43114_11111111111111111111"},
  {"symbol": "BNB", "blockchain": "bsc", "assetId": "nep245:v2_1.omni.hot.tg:56_11111111111111111111"},
  {"symbol": "POL", "blockchain": "pol", "assetId": "nep245:v2_1.omni.hot.tg:137_11111111111111111111"},
  {"symbol": "TRX", "blockchain": "tron", "assetId": "nep141:tron.omft.near"},
  {"symbol": "XLM", "blockchain": "stellar", "assetId": "nep245:v2_1.omni.hot.tg:1100_111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz"},
  {"symbol": "STRK", "blockchain": "starknet", "assetId": "nep141:starknet.omft.near"},
  {"symbol": "ARB", "blockchain": "arb", "assetId": "nep141:arb-0x912ce59144191c1204e64559fe8253a0e49e6548.omft.near"},
  {"symbol": "OP", "blockchain": "op", "assetId": "nep245:v2_1.omni.hot.tg:10_vLAiSt9KfUGKpw5cD3vsSyNYBo7"},
  {"symbol": "BERA", "blockchain": "bera", "assetId": "nep141:bera.omft.near"},
  {"symbol": "MON", "blockchain": "monad", "assetId": "nep245:v2_1.omni.hot.tg:143_11111111111111111111"},
  {"symbol": "FOGO", "blockchain": "fogo", "assetId": "nep141:fogo.omdep.near"},
  {"symbol": "XPL", "blockchain": "plasma", "assetId": "nep141:plasma.omft.near"},
  {"symbol": "ALEO", "blockchain": "aleo", "assetId": "nep141:aleo.omft.near"},
  {"symbol": "DASH", "blockchain": "dash", "assetId": "nep141:dash.omft.near"},
  {"symbol": "MOVE", "blockchain": "movement", "assetId": "nep141:movement.omft.near"},
  {"symbol": "ADI", "blockchain": "adi", "assetId": "nep245:v2_1.omni.hot.tg:36900_11111111111111111111"},
  {"symbol": "AAVE", "blockchain": "eth", "assetId": "nep141:eth-0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9.omft.near"},
  {"symbol": "UNI", "blockchain": "eth", "assetId": "nep141:eth-0x1f9840a85d5af5bf1d1762f925bdaddc4201f984.omft.near"},
  {"symbol": "LINK", "blockchain": "eth", "assetId": "nep141:eth-0x514910771af9ca656af840dff83e8264ecf986ca.omft.near"},
  {"symbol": "SHIB", "blockchain": "eth", "assetId": "nep141:eth-0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce.omft.near"},
  {"symbol": "PEPE", "blockchain": "eth", "assetId": "nep141:eth-0x6982508145454ce325ddbe47a25d4ec3d2311933.omft.near"},
  {"symbol": "TURBO", "blockchain": "eth", "assetId": "nep141:eth-0xa35923162c49cf95e6bf26623385eb431ad920d3.omft.near"},
  {"symbol": "DAI", "blockchain": "eth", "assetId": "nep141:eth-0x6b175474e89094c44da98b954eedeac495271d0f.omft.near", "selectorHidden": true},
  {"symbol": "USDT", "blockchain": "eth", "assetId": "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", "selectorHidden": true},
  {"symbol": "XAUT", "blockchain": "eth", "assetId": "nep141:eth-0x68749665ff8d2d112fa859aa293f07a622782f38.omft.near"},
  {"symbol": "PENGU", "blockchain": "sol", "assetId": "nep141:sol-0xaad74c68eecfc9f8c5bdcea614f6167048c795ef.omdep.near"},
  {"symbol": "TRUMP", "blockchain": "sol", "assetId": "nep141:sol-c58e6539c2f2e097c251f8edf11f9c03e581f8d4.omft.near"},
  {"symbol": "BOME", "blockchain": "sol", "assetId": "nep141:sol-57d087fd8c460f612f8701f5499ad8b2eec5ab68.omft.near"},
  {"symbol": "$WIF", "blockchain": "sol", "assetId": "nep141:sol-b9c68f94ec8fd160137af8cdfe5e61cd68e2afba.omft.near"},
  {"symbol": "KAITO", "blockchain": "base", "assetId": "nep141:base-0x98d0baa52b2d063e780de12f615f963fe8537553.omft.near"},
  {"symbol": "BRETT", "blockchain": "base", "assetId": "nep141:base-0x532f27101965dd16442e59d40670faf5ebb142e4.omft.near"},
  {"symbol": "SWEAT", "blockchain": "near", "assetId": "nep141:token.sweat"},
  {"symbol": "RHEA", "blockchain": "near", "assetId": "nep141:token.rhealab.near"},
  {"symbol": "FRAX", "blockchain": "near", "assetId": "nep141:853d955acef822db058eb8505911ed77f175b99e.factory.bridge.near", "selectorHidden": true},
  {"symbol": "BLACKDRAGON", "blockchain": "near", "assetId": "nep141:blackdragon.tkn.near"},
  {"symbol": "SHITZU", "blockchain": "near", "assetId": "nep141:token.0xshitzu.near"},
  {"symbol": "ABG", "blockchain": "near", "assetId": "nep141:abg-966.meme-cooking.near", "selectorHidden": true},
  {"symbol": "NOEAR", "blockchain": "near", "assetId": "nep141:noear-324.meme-cooking.near", "selectorHidden": true},
  {"symbol": "mpDAO", "blockchain": "near", "assetId": "nep141:mpdao-token.near"},
  {"symbol": "JAMBO", "blockchain": "near", "assetId": "nep141:jambo-1679.meme-cooking.near"},
  {"symbol": "NearKat", "blockchain": "near", "assetId": "nep141:kat.token0.near"},
  {"symbol": "GNEAR", "blockchain": "near", "assetId": "nep141:gnear-229.meme-cooking.near", "selectorHidden": true},
  {"symbol": "TESTNEBULA", "blockchain": "near", "assetId": "nep141:test-token.highdome3013.near", "selectorHidden": true},
  {"symbol": "PUBLIC", "blockchain": "near", "assetId": "nep141:token.publicailab.near"},
  {"symbol": "ITLX", "blockchain": "near", "assetId": "nep141:itlx.intellex_xyz.near", "selectorHidden": true},
  {"symbol": "CFI", "blockchain": "near", "assetId": "nep141:cfi.consumer-fi.near"},
  {"symbol": "SSC1_PIT", "blockchain": "base", "assetId": "nep141:base-0xc2bc2a4cd04358281c7cf36a057fc15e5552b18b.omdep.near", "selectorHidden": true},
  {"symbol": "NPRO", "blockchain": "near", "assetId": "nep141:npro.nearmobile.near"},
  {"symbol": "AURORA", "blockchain": "eth", "assetId": "nep141:eth-0xaaaaaa20d9e0e2461697782ef11675f668207961.omft.near"},
  {"symbol": "cbBTC", "blockchain": "eth", "assetId": "nep141:eth-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.omft.near", "selectorHidden": true},
  {"symbol": "KNC", "blockchain": "eth", "assetId": "nep141:eth-0xdefa4e8a7bcba345f687a2f1456f5edd9ce97202.omft.near"},
  {"symbol": "GNO", "blockchain": "gnosis", "assetId": "nep141:gnosis-0x9c58bacc331c9aa871afd802db6379a98e80cedb.omft.near"},
  {"symbol": "COW", "blockchain": "gnosis", "assetId": "nep141:gnosis-0x177127622c4a00f3d409b75571e12cb3c8973d3c.omft.near"},
  {"symbol": "SAFE", "blockchain": "eth", "assetId": "nep141:eth-0x5afe3855358e112b5647b952709e6165e1c1eeee.omft.near"},
  {"symbol": "ASTER", "blockchain": "bsc", "assetId": "nep245:v2_1.omni.hot.tg:56_12zbnsg6xndDVj25QyL82YMPudb"},
  {"symbol": "OKB", "blockchain": "xlayer", "assetId": "nep245:v2_1.omni.hot.tg:196_11111111111111111111"},
  {"symbol": "GRAM", "blockchain": "ton", "assetId": "nep245:v2_1.omni.hot.tg:1117_"},
  {"symbol": "WBTC", "blockchain": "eth", "assetId": "nep141:eth-0x2260fac5e5542a773aa44fbcfedf7c193bc2c599.omft.near", "selectorHidden": true},
  {"symbol": "SPX", "blockchain": "eth", "assetId": "nep141:eth-0xe0f63a424a4439cbe457d80e4f4b51ad25b2c56c.omft.near"},
  {"symbol": "INX", "blockchain": "eth", "assetId": "nep141:eth-0xdef1b2d939edc0e4d35806c59b3166f790175afe.omft.near"},
  {"symbol": "TITN", "blockchain": "base", "assetId": "nep141:base-0xe62bfbe57763ec24c0f130426f34dbce11fc5b06.omft.near"},
  {"symbol": "VVV", "blockchain": "base", "assetId": "nep141:base-0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf.omft.near"},
  {"symbol": "USDG", "blockchain": "hood", "assetId": "nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near", "selectorHidden": true},
  {"symbol": "PONS", "blockchain": "hood", "assetId": "nep141:hood-0x39dbed3a2bd333467115de45665cc57f813c4571.omft.near"},
  {"symbol": "CASHCAT", "blockchain": "hood", "assetId": "nep141:hood-0x020bfc650a365f8bb26819deaabf3e21291018b4.omft.near"},
  {"symbol": "xBTC", "blockchain": "sol", "assetId": "nep141:sol-91914f13d3b54f8126a2824d71632d4b078d7403.omft.near", "selectorHidden": true},
  {"symbol": "USDT0", "blockchain": "arb", "assetId": "nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near", "selectorHidden": true},
  {"symbol": "WETH", "blockchain": "eth", "assetId": "nep141:eth-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.omft.near", "selectorHidden": true},
  {"symbol": "xDAI", "blockchain": "gnosis", "assetId": "nep141:gnosis.omft.near", "selectorHidden": true},
  {"symbol": "PURGE", "blockchain": "near", "assetId": "nep141:purge-558.meme-cooking.near"},
  {"symbol": "HAPI", "blockchain": "eth", "assetId": "nep141:eth-0xd9c2d319cd7e6177336b0a9c93c21cb48d84fb54.omft.near"},
  {"symbol": "sUSDC", "blockchain": "base", "assetId": "nep141:base-0x1c4a802fd6b591bb71daa01d8335e43719048b24.omft.near", "selectorHidden": true},
  {"symbol": "sUSDC", "blockchain": "sol", "assetId": "nep141:sol-2dc7b64e5dd3c717fc85abaf51cdcd4b18687f09.omft.near", "selectorHidden": true},
  {"symbol": "USAD", "blockchain": "aleo", "assetId": "nep141:aleo-usad.omft.near", "selectorHidden": true},
  {"symbol": "USDCx", "blockchain": "aleo", "assetId": "nep141:aleo-usdcx.omft.near", "selectorHidden": true},
  {"symbol": "stNEAR", "blockchain": "near", "assetId": "nep141:meta-pool.near", "selectorHidden": true},
  {"symbol": "kV-gtSOLb", "blockchain": "sol", "assetId": "nep141:sol-0xa69aa1bcb03a369e338156a8718ad60271145803.omdep.near", "selectorHidden": true},
  {"symbol": "GMX", "blockchain": "arb", "assetId": "nep141:arb-0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a.omft.near"},
  {"symbol": "TLO", "blockchain": "eth", "assetId": "nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near"},
  {"symbol": "steakUSDC", "blockchain": "eth", "assetId": "nep141:eth-0xaf08e292d62df255f7953665a44ed65f0380aa60.omft.near", "selectorHidden": true},
  {"symbol": "MOG", "blockchain": "eth", "assetId": "nep141:eth-0xaaee1a9723aadb7afa2810263653a34ba2c21c7a.omft.near"},
  {"symbol": "gtUSDCp", "blockchain": "base", "assetId": "nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near", "selectorHidden": true},
  {"symbol": "sparkUSDC", "blockchain": "base", "assetId": "nep141:base-0x7429743f8adbbe932b27bc02267b0e70f1ba688b.omft.near", "selectorHidden": true},
  {"symbol": "mwUSDC", "blockchain": "base", "assetId": "nep141:base-0x3388d158fdcc31398b99478420e6945cdaace009.omft.near", "selectorHidden": true},
  {"symbol": "laUSDC", "blockchain": "base", "assetId": "nep141:base-0xc343558b52b5757e3d59f0fe12ad33b52d3e2dd2.omft.near", "selectorHidden": true},
  {"symbol": "FMS", "blockchain": "base", "assetId": "nep141:base-0xa5c67d8d37b88c2d88647814da5578128e2c93b2.omft.near"},
  {"symbol": "MELANIA", "blockchain": "sol", "assetId": "nep141:sol-d600e625449a4d9380eaf5e3265e54c90d34e260.omft.near"},
  {"symbol": "LOUD", "blockchain": "sol", "assetId": "nep141:sol-bb27241c87aa401cc963c360c175dd7ca7035873.omft.near"},
  {"symbol": "NEARKAT", "blockchain": "sol", "assetId": "nep141:sol-0x4629c2e57ccb57f0a21e04f5b5449ef251932cec.omdep.near"},
  {"symbol": "wNEARKAT", "blockchain": "sol", "assetId": "nep141:sol-0xa1f9a1925e2dd108b1abc3248a567e69fa7ae4e8.omdep.near", "selectorHidden": true},
  {"symbol": "EURe", "blockchain": "gnosis", "assetId": "nep141:gnosis-0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430.omft.near", "selectorHidden": true},
  {"symbol": "GBPe", "blockchain": "gnosis", "assetId": "nep141:gnosis-0x5cb9073902f2035222b9749f8fb0c9bfe5527108.omft.near", "selectorHidden": true},
  {"symbol": "USDf", "blockchain": "eth", "assetId": "nep141:eth-0xfa2b947eec368f42195f24f36d2af29f7c24cec2.omft.near", "selectorHidden": true},
  {"symbol": "USD1", "blockchain": "eth", "assetId": "nep141:eth-0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d.omft.near", "selectorHidden": true},
  {"symbol": "STJACK", "blockchain": "near", "assetId": "nep141:stjack.tkn.primitives.near"},
  {"symbol": "EVAA", "blockchain": "bsc", "assetId": "nep245:v2_1.omni.hot.tg:56_3NNshCLCt8r8E7x9FoDuiwoNQWgp"},
  {"symbol": "nrUsdt", "blockchain": "near", "assetId": "nep141:lsd-usdt.rhealab.near", "selectorHidden": true},
  {"symbol": "hemiBTC", "blockchain": "eth", "assetId": "nep141:eth-0x06ea695b91700071b161a434fed42d1dcbad9f00.omft.near", "selectorHidden": true},
  {"symbol": "USDCx", "blockchain": "movement", "assetId": "nep141:movement-6f9a70ef4605e7d9174f1abf8d8d3c15012f48f3.omft.near", "selectorHidden": true},
  {"symbol": "COCA", "blockchain": "pol", "assetId": "nep141:pol-0x7b12598e3616261df1c05ec28de0d2fb10c1f206.omdep.near"},
  {"symbol": "USDe", "blockchain": "hood", "assetId": "nep141:hood-0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34.omft.near", "selectorHidden": true},
  {"symbol": "PRL", "blockchain": "prl", "assetId": "nep141:prl.omft.near"},
] as const;

export function canonicalAssets(catalog: readonly CatalogAsset[]): CatalogAsset[] {
  return listings.flatMap(listing => {
    const matches = catalog.filter(asset => asset.assetId === listing.assetId &&
      asset.symbol === listing.symbol && asset.blockchain === listing.blockchain);
    return matches.length === 1 ? matches : [];
  });
}

// Selector policy: canonical base tokens only, excluding fiat stablecoins and
// wrapped/staked/vault derivatives. wNEAR is the required NEAR trading representation.
// Exact listing IDs carry the policy; symbols and prices never classify assets.
export function selectableCanonicalAssets(catalog: readonly CatalogAsset[]): CatalogAsset[] {
  const hidden = new Set<string>(listings.filter(listing => "selectorHidden" in listing && listing.selectorHidden).map(listing => listing.assetId));
  return canonicalAssets(catalog).filter(asset => !hidden.has(asset.assetId) && !!asset.coingeckoId?.trim());
}

// NEAR is held as wNEAR in the verifier; the underlying asset identity is unchanged.
export function displaySymbol(asset: { assetId: string; symbol: string }) {
  return asset.assetId === DEFAULT_PAIR.base.assetId ? "NEAR" : asset.symbol;
}
