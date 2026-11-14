export const groupedHoldings = [
  { assetId: "synthetic-usdc-near", symbol: "USDC", decimals: 6, raw: "100000", amount: "0.1" },
  { assetId: "synthetic-usdc-base", symbol: "USDC", decimals: 18, raw: "200000000000000000", amount: "0.2" },
];
export const groupedCatalog = groupedHoldings.map((holding, index) => ({ ...holding, blockchain: index ? "base" : "near", coingeckoId: "usd-coin" }));
