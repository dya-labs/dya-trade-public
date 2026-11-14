import { expect, test } from "bun:test";
import { BinanceRest } from "../src/binance/rest";
import { openStream } from "../src/binance/stream";
import { parseAggTrade, toTrade, TradePublisher } from "../src/binance/trades";
import { MinuteFolder } from "../src/ingest/minutes";
import { units } from "../src/candles/bar";
import type { KlineEvent } from "../src/live/protocol";

// Explicit opt-in: public exchange traffic for eleven minutes, budget shared with local ingest.
test.skipIf(process.env.BINANCE_LIVE_ACCEPTANCE !== "1")("trade-built closed bars match Binance through a forced reconnect", async () => {
  const rest = new BinanceRest({ url: "https://data-api.binance.vision", weightBudget: 1000 });
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  const closed: KlineEvent[] = [];
  const failures: string[] = [];
  const folder = new MinuteFolder({ quoteVolume: true, trades: true, takerBuy: true }, async event => { if (event.closed) closed.push(event); });
  const publisher = new TradePublisher(rest, (symbol, trade) => folder.apply(symbol, toTrade(trade)));
  const connect = () => openStream("wss://data-stream.binance.vision", symbols.map(symbol => `${symbol.toLowerCase()}@aggTrade`), {
    onConnected() {},
    onEvent(name, data) { void publisher.accept(name.split("@")[0]!.toUpperCase(), parseAggTrade(data)).catch(error => failures.push(String(error))); },
  });
  let stream = connect();
  try {
    await Bun.sleep(310_000);
    stream.close();
    await Bun.sleep(3000);
    stream = connect();
    await Bun.sleep(350_000);
  } finally { stream.close(); await publisher.stop(); await folder.stop(); }
  expect(failures).toEqual([]);
  for (const symbol of symbols) {
    const events = closed.filter(event => event.symbol === symbol);
    expect(events.length).toBeGreaterThanOrEqual(10);
    for (const { kline } of events) {
      const [native] = await rest.klines(symbol, kline.openTime, kline.openTime, 1);
      expect(native).toBeDefined();
      expect(kline.openTime).toBe(native!.openTime);
      expect(kline.trades).toBe(native!.trades);
      for (const field of ["open", "high", "low", "close", "volume", "quoteVolume", "takerBuyVolume", "takerBuyQuoteVolume"] as const) {
        expect({ symbol, time: kline.openTime, field, value: units(kline[field]).toString() }).toEqual({ symbol, time: kline.openTime, field, value: units(native![field]).toString() });
      }
    }
  }
  console.log("Binance closed-minute parity", { minutes: closed.length, symbols, forcedDisconnectMs: 3000 });
}, 720_000);
