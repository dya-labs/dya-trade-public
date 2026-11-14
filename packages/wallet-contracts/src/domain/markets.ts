import { ACTIVE_PAIR } from "./assets";
import { AppError, ErrorCode } from "./errors";

export type MarketCapability = "marketOrders" | "limitOrders" | "chart";
export interface MarketDefinition {
  id: string;
  baseAssetId: string;
  quoteAssetId: string;
  capabilities: Record<MarketCapability, boolean>;
}
export const ACTIVE_MARKET = {
  id: ACTIVE_PAIR.id,
  baseAssetId: ACTIVE_PAIR.base.assetId,
  quoteAssetId: ACTIVE_PAIR.quote.assetId,
  capabilities: { marketOrders: true, limitOrders: true, chart: true },
} as const satisfies MarketDefinition;

export const MARKETS: readonly MarketDefinition[] = [ACTIVE_MARKET];
export function requireMarketCapability(pairId: unknown, capability: MarketCapability) {
  const market = MARKETS.find(market => market.id === (pairId ?? ACTIVE_MARKET.id));
  if (!market || !market.capabilities[capability]) throw new AppError(ErrorCode.UnsupportedMarketCapability);
  return market;
}
