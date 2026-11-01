import { INTERVALS } from "../candles/intervals";
import { log } from "../log";
import type { Venue } from "../venues/types";
import { BinanceRest } from "./rest";
import { openStream, parseMiniTicker } from "./stream";
import { parseAggTrade, toTrade, TradePublisher } from "./trades";

/** Binance spot: full 1m history with trade counts and taker volumes; live from `@aggTrade` with id-exact gap repair. */
export const binance: Venue = {
  id: "binance",
  label: "Binance",
  coinGeckoId: "binance",
  history: ["1m"],
  fields: { quoteVolume: true, trades: true, takerBuy: true },
  parityIntervals: Object.keys(INTERVALS),
  defaults: { restUrl: "https://data-api.binance.vision", streamUrl: "wss://data-stream.binance.vision", budget: 3000 },
  symbol: (base, quote) => `${base}${quote}`,
  rest: options => new BinanceRest({ url: options.restUrl, weightBudget: options.budget }),
  live: options => ({
    open(symbols, sink) {
      // Gap repair has its own weight budget; both adopt Binance's reported per-IP usage.
      const publisher = new TradePublisher(new BinanceRest({ url: options.restUrl, weightBudget: options.budget }), (symbol, trade) => sink.trade(symbol, toTrade(trade)));
      const streams = [...symbols].map(symbol => symbol.toLowerCase()).sort().flatMap(symbol => [`${symbol}@aggTrade`, `${symbol}@miniTicker`]);
      const stream = openStream(options.streamUrl, streams, {
        onConnected: connected => sink.connected(connected),
        onEvent: (name, data) => {
          try {
            if (name.endsWith("@aggTrade")) {
              publisher.accept(name.split("@")[0]!.toUpperCase(), parseAggTrade(data)).catch(error => log("binance.trades.repair", { error: String(error) }, "error"));
            } else sink.ticker(parseMiniTicker(data));
          } catch (error) {
            sink.invalid(`${name}: ${String(error)}`);
          }
        },
      });
      return { close() { stream.close(); void publisher.stop(); } };
    },
  }),
};
