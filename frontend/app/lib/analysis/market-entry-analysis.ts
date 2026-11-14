import { DataApi, DataApiError, type PageBar } from "@/lib/market-data/api";
import { INTERVAL_MS } from "@/lib/market-data/pages";
import type { CatalogAsset } from "@/lib/near/domain/catalog";
import { assertJevConfigured, createEntryPlan, type Interval, type MarketCandle } from "./entry-analysis";
import { jevMarket } from "@/lib/near/http/schemas/market";
import { AppError, ErrorCode } from "@/lib/near/domain/errors";

const INTERVALS: Interval[] = ["1d", "4h", "1h"];
// Evidence uses up to 180 closed 4h, 90 daily and 72 hourly candles; one extra covers the open bar.
const NEEDED: Record<Interval, number> = { "1d": 91, "4h": 181, "1h": 73 };

const toCandle = (interval: Interval) => (row: PageBar): MarketCandle => ({
  time: row[0] / 1000, open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]),
  closeTime: row[0] + INTERVAL_MS[interval] - 1,
});

/** Jev's daily, 4h and hourly candles from the asset's primary data-API market, which must be an exchange quoted in USD, USDC or USDT. */
export async function loadAnalysisMarket(asset: CatalogAsset, api: DataApi) {
  const [{ revision }, { assets }, { markets }] = await Promise.all([api.meta(), api.assets(), api.markets()]);
  const entry = assets.find(item => item.assetId === asset.assetId);
  const market = markets.find(item => item.id === entry?.primaryMarket && item.assetId === asset.assetId);
  const identity = market && jevMarket(market);
  if (!market || !identity) throw new AppError(ErrorCode.JevNeedsAnExchangeMarket);
  const candles = await Promise.all(INTERVALS.map(async interval => {
    const latest = await api.latest(market.id, interval);
    if (latest.revision !== revision) throw new DataApiError(502, "Market data is unavailable. Try again shortly.");
    const rows = latest.bars.length < NEEDED[interval] && latest.prev !== null
      ? [...(await api.page(market.id, interval, latest.prev, revision)).bars, ...latest.bars]
      : latest.bars;
    return rows.map(toCandle(interval));
  }));
  return {
    identity,
    market: { async get(interval: Interval) { return { candles: candles[INTERVALS.indexOf(interval)] }; } },
  };
}

export async function createMarketEntryPlan(asset: CatalogAsset) {
  assertJevConfigured();
  const { identity, market } = await loadAnalysisMarket(asset, new DataApi(process.env.DATA_API_ORIGIN || "http://127.0.0.1:8080"));
  return createEntryPlan(market, Date.now(), undefined, identity);
}
