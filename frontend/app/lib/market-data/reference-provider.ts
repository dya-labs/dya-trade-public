import { DataUnavailableError, type DataProvider } from "@luxalgo/vela";
import { intervalFor, REFERENCE_LABEL, TIMEFRAME_BY_INTERVAL, type BarSource, type ChartMarket } from "./chart-feed";

/**
 * The Vela provider of an asset's reference market, listed under `ticker` (e.g. `NEAR/USD`) with
 * the venue label "Reference": the UI never names the exchange behind it.
 */
export function createReferenceProvider({ source, market, ticker, intervals, mintick }: {
  source: BarSource;
  market: ChartMarket;
  ticker: string;
  intervals: readonly string[];
  /** The price step the axis and legend print. */
  mintick: number;
}): DataProvider {
  const supported = intervals.filter(interval => interval in TIMEFRAME_BY_INTERVAL);
  const timeframes = supported.map(interval => TIMEFRAME_BY_INTERVAL[interval]!);
  const preferred = supported.includes("15m") ? TIMEFRAME_BY_INTERVAL["15m"]! : timeframes[0]!;
  const checked = (requested: string, timeframe: string) => {
    if (requested !== ticker) throw new Error(`Unknown symbol ${requested}`);
    const interval = intervalFor(timeframe);
    if (!interval || !supported.includes(interval)) throw new DataUnavailableError({ reason: "timeframe", symbol: ticker, timeframe, finest: timeframes[0], default: preferred });
    return interval;
  };
  return {
    info: () => ({ name: "reference", displayName: REFERENCE_LABEL, supportedTimeframes: timeframes, capabilities: { enumerate: true, stream: true, symbolInfo: true } }),
    listSymbols: async () => [{ ticker, description: ticker, type: "crypto", prefix: REFERENCE_LABEL }],
    getSymbolInfo: async requested => requested === ticker ? { ticker, timezone: "Etc/UTC", session: "24x7", timeframes: { finest: timeframes[0]!, default: preferred, list: timeframes }, mintick } : undefined,
    getBars: async (requested, timeframe, range) => source.history(market, checked(requested, timeframe), range),
    subscribe: (requested, timeframe, onBar) => source.live(market, checked(requested, timeframe), onBar),
  };
}
