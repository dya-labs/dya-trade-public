# Token artwork

Bundled icons come first: CoinMarketCap 64×64 logos for the verified CoinGecko → CoinMarketCap identities in `packages/wallet-contracts/src/market-data/coinmarketcap.ts`, refreshed by `packages/wallet-ui/scripts/update-token-icons.mjs`. No symbol matching is used.

Other tokens use CoinGecko `/coins/markets` images from the data API's `token-markets` snapshot (`/v1/token-markets`, refreshed every 10 minutes), keyed by 1Click asset id. Only HTTPS images on CoinGecko's image hosts are accepted. The display mapping `nep141:wrap.near` → CoinGecko `near` matches the NEAR label without changing the traded asset. Unsupported or failed images use a neutral placeholder.

DYA ID caches that icon map for an hour in Next.js Data Cache. Failed revalidation throws to retain the last successful cached result; cold failures return placeholders. The client considers icons fresh for 24 hours; image bytes follow the image host's HTTP cache headers. Icon lookup never blocks trading.
