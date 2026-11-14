import { expect, test } from "bun:test";
import { parseAggTrade, toTrade, TradePublisher, type AggTrade } from "../src/binance/trades";
import { MinuteFolder, TradeBar } from "../src/ingest/minutes";
import type { KlineEvent } from "../src/live/protocol";

function trade(id: number, time = 60_001): AggTrade {
  return { id, time, first: id * 2, last: id * 2 + 1, price: "0.12345678", quantity: "0.1", maker: false };
}

test("aggregate trade folding retains exact quote precision and underlying trade counts", () => {
  const bar = new TradeBar(toTrade(trade(1)), { quoteVolume: true, trades: true, takerBuy: true });
  bar.add(toTrade({ ...trade(2), maker: true }));
  expect(bar.snapshot()).toEqual({ openTime: 60_000, open: "0.12345678", high: "0.12345678", low: "0.12345678", close: "0.12345678", volume: "0.2", quoteVolume: "0.02469135", trades: 4, takerBuyVolume: "0.1", takerBuyQuoteVolume: "0.01234567" });
  expect(() => parseAggTrade({ a: 1, T: 1, f: 1, l: 1, p: "NaN", q: "1", m: false })).toThrow();
});

test("live minutes zero the fields a venue's REST candles lack, so settled minutes match", () => {
  const bar = new TradeBar({ time: 60_001, price: "0.0000001066", quantity: "360000000", count: 3, takerBuy: true }, { quoteVolume: false, trades: false, takerBuy: false });
  expect(bar.snapshot()).toMatchObject({ open: "0.0000001066", volume: "360000000", quoteVolume: "0", trades: 0, takerBuyVolume: "0", takerBuyQuoteVolume: "0" });
});

test("bootstrap and reconnect repair precede live trades and duplicates never double count", async () => {
  const events: KlineEvent[] = [];
  const cursors: unknown[] = [];
  const folder = new MinuteFolder({ quoteVolume: true, trades: true, takerBuy: true }, async event => { events.push(event); });
  const publisher = new TradePublisher({ aggTrades: async (_symbol, cursor) => {
    cursors.push(cursor);
    return "startTime" in cursor ? [trade(1), trade(2)] : [trade(3), trade(4)];
  } }, (symbol, aggregate) => folder.apply(symbol, toTrade(aggregate)));
  await publisher.accept("BTCUSDT", trade(2));
  await publisher.accept("BTCUSDT", trade(4));
  await publisher.accept("BTCUSDT", trade(4));
  await publisher.accept("BTCUSDT", trade(5, 120_001));
  await publisher.stop();
  await folder.stop();
  expect(cursors).toEqual([{ startTime: 60_000 }, { fromId: 3 }]);
  const closed = events.find(event => event.closed);
  expect(closed?.kline.trades).toBe(8);
  expect(closed?.kline.volume).toBe("0.4");
});

test("a late trade for an already closed minute does not reopen it", async () => {
  const events: KlineEvent[] = [];
  const folder = new MinuteFolder({ quoteVolume: true, trades: false, takerBuy: false }, async event => { events.push(event); });
  const at = (time: number, price: string) => ({ time, price, quantity: "1", count: 1, takerBuy: null });
  folder.apply("MOGUSDT", at(60_001, "1"));
  folder.apply("MOGUSDT", at(120_001, "2"));
  folder.apply("MOGUSDT", at(119_999, "9"));
  await folder.stop();
  expect(events.filter(event => event.closed).map(event => event.kline.openTime)).toEqual([60_000]);
  expect(events.at(-1)?.kline).toMatchObject({ openTime: 120_000, high: "2", volume: "1" });
});
