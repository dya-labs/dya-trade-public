/** A DEX pair we index ourselves (Rhea): its token contracts and decimals. */
export type OnchainPair = { base: string; quote: string; baseDecimals: number; quoteDecimals: number };
export type RegistrySource = {
  id: string; venue: string; symbol: string; base: string; quote: string; rank: number;
  validFrom: number; validTo: number | null; coinGeckoTickerUrl: string;
  continuationOf: string | null; conversionRatio: string; continuationEvidence?: string;
  /** Only for venues built from on-chain swaps; read from seed.json by the ingest. */
  onchain?: OnchainPair;
};
export type RegistryAsset = {
  assetId: string; symbol: string; chain: string; contract: string | null;
  coinGeckoId: string | null; aliases: string[]; sources: RegistrySource[]; unavailableReason: string | null;
};
export type RegistrySeed = {
  generatedAt: string; catalogUrl: string; exchangeInfoUrl: string; assets: RegistryAsset[];
  /** 1Click catalog asset IDs of reviewed USD stablecoins (wallet-contracts `isSupportedStablecoin`), worth $1 in Intents trades. */
  stablecoins: string[];
};
