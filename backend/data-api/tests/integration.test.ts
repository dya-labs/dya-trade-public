// Runs against real ClickHouse + Redis: `docker compose up -d && DATA_API_INTEGRATION=1 bun test`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RedisClient } from "bun";
import { BarReader } from "../src/api/bars";
import { anchorFor } from "../src/candles/intervals";
import { klineRow, priceDecimal, type Kline } from "../src/candles/kline";
import { CandleStore, firstFor } from "../src/candles/store";
import { ClickHouse } from "../src/clickhouse";
import { loadConfig } from "../src/config";
import { liveKeys } from "../src/live/protocol";
import { migrate } from "../src/migrate";

const enabled = process.env.DATA_API_INTEGRATION === "1";
const config = loadConfig({ ...process.env, CLICKHOUSE_DATABASE: process.env.DATA_API_TEST_DATABASE ?? `market_rest_test_${process.pid}` });
const clickhouse = new ClickHouse(config.clickhouse);
const market = { venue: `test_rest_${process.pid}`, symbol: "TESTUSDT" };
const tiered = { venue: market.venue, symbol: "TIERED_USDT" };
const H = 3_600_000;
const T0 = Date.parse("2026-01-30T22:00:00Z");

// Deterministic minutes: price rises 0.01 per minute, volume 0.1 per minute.
const minute = (i: number): Kline => ({
  openTime: T0 + i * 60_000, open: priceDecimal((100 + i / 100).toFixed(8)), high: priceDecimal((100 + i / 100 + 0.5).toFixed(8)),
  low: priceDecimal((100 + i / 100 - 0.5).toFixed(8)), close: priceDecimal((100 + i / 100).toFixed(8)),
  volume: "0.1", quoteVolume: "10", trades: 1, takerBuyVolume: "0.05", takerBuyQuoteVolume: "5",
});
const state = (symbol: string, dataset: string, first: number, synced: number) => ({ venue: market.venue, symbol, dataset, first_open_time: String(first), synced_to: String(synced), updated_at: String(Date.now()) });

describe.skipIf(!enabled)("ClickHouse + Redis read model", () => {
  let redis: RedisClient;
  const store = new CandleStore(clickhouse);

  beforeAll(async () => {
    await clickhouse.command(`DROP DATABASE IF EXISTS ${config.clickhouse.database}`, {}, "default");
    await migrate(clickhouse, () => {});
    redis = new RedisClient(config.redisUrl);
    await redis.connect();
    await redis.del(liveKeys(market.venue).recent(market.symbol));
    // 6 hours of minutes, inserted twice: the second copy (later ingested_at) wins under FINAL.
    const corrupt = Array.from({ length: 360 }, (_, i) => ({ ...klineRow(market.venue, market.symbol, minute(i)), volume: "999", ingested_at: String(T0) }));
    await clickhouse.insert("klines_1m", corrupt);
    await clickhouse.insert("klines_1m", Array.from({ length: 360 }, (_, i) => klineRow(market.venue, market.symbol, minute(i))));
    await clickhouse.insert("sync_state", [state(market.symbol, "klines_1m", T0, T0 + 150 * 60_000)]);
  });

  afterAll(async () => {
    await redis?.del(liveKeys(market.venue).recent(market.symbol));
    redis?.close();
  });

  test("aggregates deduplicated minutes into hourly and monthly buckets", async () => {
    const coverage = await store.coverage(market);
    const hours = await store.bars(market, coverage, "1h", 0, T0, T0 + 6 * H);
    expect(hours).toHaveLength(6);
    expect(hours[0]).toEqual({ openTime: T0, open: "100", high: "101.09", low: "99.5", close: "100.59", volume: "6", quoteVolume: "600", trades: 60, takerBuyVolume: "3", takerBuyQuoteVolume: "300" });
    // T0 is Jan 30 22:00; the 6 hours span the January/February boundary.
    const months = await store.bars(market, coverage, "1M", 0, T0, T0 + 6 * H);
    expect(months.map(bar => [new Date(bar.openTime).toISOString(), bar.trades])).toEqual([["2026-01-01T00:00:00.000Z", 360]]);
    const days = await store.bars(market, coverage, "1d", 0, T0, T0 + 6 * H);
    expect(days.map(bar => bar.trades)).toEqual([120, 240]);
    const threeDays = await store.bars(market, coverage, "3d", anchorFor("3d", Date.parse("2026-01-30T05:00:00Z")), T0, T0 + 6 * H);
    expect(threeDays.map(bar => new Date(bar.openTime).toISOString())).toEqual(["2026-01-30T00:00:00.000Z"]);
  });

  test("sub-1e-8 prices survive storage exactly", async () => {
    const tiny = { ...minute(0), open: "0.000000012328", high: "0.000000012401", low: "0.000000012011", close: "0.000000012399" };
    const ref = { venue: market.venue, symbol: "TINY_USDT" };
    await clickhouse.insert("klines_1m", [klineRow(ref.venue, ref.symbol, tiny)]);
    await clickhouse.insert("sync_state", [state(ref.symbol, "klines_1m", T0, T0 + H)]);
    const [bar] = await store.bars(ref, await store.coverage(ref), "1m", 0, T0, T0 + 60_000);
    expect(bar).toMatchObject({ open: "0.000000012328", high: "0.000000012401", low: "0.000000012011", close: "0.000000012399" });
  });

  test("native 1h/1d tiers extend coarse intervals before the first minute without double counting", async () => {
    const D = 24 * H;
    const first1m = T0 + 90 * 60_000; // 23:30: the 1m tier is used from 00:00, native 1h covers before it.
    const first1h = T0 - 10 * H;      // Jan 30 12:00: native 1d covers through Jan 30.
    const first1d = T0 - 22 * H - 3 * D;
    const bar = (openTime: number, volume: string): Kline => ({ openTime, open: "1", high: "2", low: "0.5", close: "1.5", volume, quoteVolume: volume, trades: 0, takerBuyVolume: "0", takerBuyQuoteVolume: "0" });
    await clickhouse.insert("klines_1m", Array.from({ length: 150 }, (_, i) => klineRow(tiered.venue, tiered.symbol, { ...minute(90 + i), trades: 0, takerBuyVolume: "0", takerBuyQuoteVolume: "0" })));
    await clickhouse.insert("klines_native", [
      ...Array.from({ length: 12 }, (_, i) => ({ ...klineRow(tiered.venue, tiered.symbol, bar(first1h + i * H, "7")), resolution: "1h" })),
      ...Array.from({ length: 4 }, (_, i) => ({ ...klineRow(tiered.venue, tiered.symbol, bar(first1d + i * D, "1000")), resolution: "1d" })),
    ]);
    await clickhouse.insert("sync_state", [
      state(tiered.symbol, "klines_1m", first1m, T0 + 240 * 60_000),
      state(tiered.symbol, "klines_1h", first1h, T0 + 2 * H),
      state(tiered.symbol, "klines_1d", first1d, T0 - 22 * H),
    ]);
    const coverage = await store.coverage(tiered);
    expect([firstFor(coverage, "15m"), firstFor(coverage, "4h"), firstFor(coverage, "1w")]).toEqual([first1m, first1h, first1d]);
    // 1h: 12 native hours (12:00..23:00), then 00:00..01:00 from minutes; the 23:30-23:59 minutes are inside the native 23:00 hour.
    const hours = await store.bars(tiered, coverage, "1h", 0, first1h, T0 + 4 * H);
    expect(hours.map(hour => hour.volume)).toEqual([...Array(12).fill("7"), "6", "6"]);
    // 1d: native days through Jan 30 (the 1h tier starts mid-day, so the first whole 1h day is Jan 31), then minutes.
    const days = await store.bars(tiered, coverage, "1d", 0, first1d, T0 + 4 * H);
    expect(days.map(day => [new Date(day.openTime).toISOString().slice(0, 10), day.volume])).toEqual([
      ["2026-01-27", "1000"], ["2026-01-28", "1000"], ["2026-01-29", "1000"], ["2026-01-30", "1000"], ["2026-01-31", "12"],
    ]);
  });

  test("bars below the sync watermark come from ClickHouse, later minutes from Redis", async () => {
    const reader = new BarReader({ store, redis });
    // ClickHouse claims coverage up to minute 150 (02:30 into the run); Redis holds 140..389.
    const live = Array.from({ length: 250 }, (_, i) => minute(140 + i));
    // Redis copies of minutes before the watermark must be ignored, not double counted.
    live[0] = { ...live[0]!, volume: "999" };
    await redis.hset(liveKeys(market.venue).recent(market.symbol), Object.fromEntries(live.map(kline => [kline.openTime, JSON.stringify(kline)])));
    const { bars, final } = await reader.read(market, "1h", 0, T0, T0 + 8 * H);
    expect(final).toBe(false);
    expect((await reader.read(market, "1h", 0, T0, T0 + 2 * H)).final).toBe(true);
    expect(bars.map(bar => bar.trades)).toEqual([60, 60, 60, 60, 60, 60, 30]);
    expect(bars.every(bar => bar.volume === String(bar.trades / 10))).toBe(true);
    expect(bars.at(-1)).toMatchObject({ openTime: T0 + 6 * H, close: minute(389).close });
    const tail = await reader.tail(market, "1h", 0, T0 + 2 * H);
    expect({ seed: tail.seed?.trades, cutoff: tail.cutoff, minutes: tail.minutes.length }).toEqual({ seed: 30, cutoff: T0 + 150 * 60_000, minutes: 30 });
  });
});
