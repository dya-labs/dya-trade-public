import { describe, expect, test } from "bun:test";
import { parseRestKline } from "../src/binance/klines";
import { numberDecimal, priceDecimal, volumeDecimal, type Kline } from "../src/candles/kline";
import { foldBar, units, decimal } from "../src/candles/bar";
import { anchorFor, bucketStart, pageBounds, pageIndex, shiftBuckets } from "../src/candles/intervals";
import { firstFor, tiers } from "../src/candles/store";

const t = (iso: string) => Date.parse(iso);
const minute = (openTime: number, o: string, h: string, l: string, c: string, v: string, trades = 1): Kline => ({
  openTime, open: o, high: h, low: l, close: c, volume: v, quoteVolume: v, trades, takerBuyVolume: v, takerBuyQuoteVolume: v,
});

describe("bucket grid matches Binance native klines", () => {
  test("weeks open Monday 00:00 UTC", () => {
    expect(bucketStart("1w", t("2026-10-11T23:59:00Z"), anchorFor("1w", null))).toBe(t("2026-10-05T00:00:00Z"));
    expect(bucketStart("1w", t("2026-10-12T00:00:00Z"), anchorFor("1w", null))).toBe(t("2026-10-12T00:00:00Z"));
  });

  test("3d buckets are anchored to each symbol's first trading day", () => {
    // Observed on data-api.binance.vision: BTCUSDT 3d opens 2026-10-11, SOLUSDT 2026-10-12, NEARUSDT 2026-10-10.
    const at = t("2026-10-12T15:00:00Z");
    expect(bucketStart("3d", at, anchorFor("3d", t("2017-08-17T04:00:00Z")))).toBe(t("2026-10-11T00:00:00Z"));
    expect(bucketStart("3d", at, anchorFor("3d", t("2020-08-11T06:00:00Z")))).toBe(t("2026-10-12T00:00:00Z"));
    expect(bucketStart("3d", at, anchorFor("3d", t("2020-10-14T05:00:00Z")))).toBe(t("2026-10-10T00:00:00Z"));
  });

  test("months are calendar months and shift across years", () => {
    expect(bucketStart("1M", t("2024-02-29T23:59:00Z"), 0)).toBe(t("2024-02-01T00:00:00Z"));
    expect(shiftBuckets("1M", t("2025-11-01T00:00:00Z"), 3)).toBe(t("2026-02-01T00:00:00Z"));
    expect(shiftBuckets("1M", t("2026-01-01T00:00:00Z"), -1)).toBe(t("2025-12-01T00:00:00Z"));
  });

  test("aligned pages reach the first minute without lookback limits", () => {
    const first = t("2017-08-17T04:00:00Z");
    const page = pageIndex("1m", first, 0);
    const bounds = pageBounds("1m", page, 0);
    expect(bounds.from).toBeLessThanOrEqual(first);
    expect(bounds.end).toBeGreaterThan(first);
    expect(bounds.end - bounds.from).toBe(1000 * 60_000);
    expect(pageIndex("1m", bounds.end, 0)).toBe(page + 1);
    expect(pageIndex("1M", t("2053-05-01T00:00:00Z"), 0)).toBe(1);
    expect(pageBounds("1M", 1, 0).from).toBe(t("2053-05-01T00:00:00Z"));
    const anchor = anchorFor("3d", first);
    expect(pageIndex("3d", first, anchor)).toBe(0);
    expect(pageBounds("3d", 0, anchor).from).toBe(t("2017-08-17T00:00:00Z"));
  });
});

describe("bar folding", () => {
  test("decimal sums are exact where floats drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    const bar = foldBar(0, undefined, [minute(0, "1", "1", "1", "1", "0.1"), minute(60_000, "1", "1", "1", "1", "0.2")]);
    expect(bar?.volume).toBe("0.3");
    expect(decimal(units("123456789012345678901.12345678") * 2n)).toBe("246913578024691357802.24691356");
  });

  test("open comes from the first minute, close from the last, extremes across all", () => {
    const bar = foldBar(0, undefined, [
      minute(0, "10.5", "11", "10", "10.9", "1", 2),
      minute(60_000, "10.9", "12.25", "10.8", "11.1", "2", 3),
      minute(120_000, "11.1", "11.2", "9.99", "11", "3", 4),
    ]);
    expect(bar).toMatchObject({ open: "10.5", high: "12.25", low: "9.99", close: "11", volume: "6", trades: 9 });
  });

  test("a seed continues the bucket: its open survives and its sums carry", () => {
    const seed = foldBar(0, undefined, [minute(0, "5", "6", "4", "5.5", "10", 7)])!;
    const bar = foldBar(0, seed, [minute(60_000, "5.5", "5.6", "3", "5.2", "1.5", 1)]);
    expect(bar).toMatchObject({ openTime: 0, open: "5", high: "6", low: "3", close: "5.2", volume: "11.5", trades: 8 });
  });
});

describe("zero-trade filler minutes", () => {
  // Binance SOLUSDC 2021-09-27: 1m opens at the carried close 135.63 with 0 trades; native 1d/1w open is 135.88.
  test("open/high/low come from traded minutes when the bucket traded", () => {
    const bar = foldBar(0, undefined, [
      minute(0, "135.63", "135.63", "135.63", "135.63", "0", 0),
      minute(60_000, "135.88", "136", "135.7", "135.9", "2", 3),
      minute(120_000, "135.9", "135.9", "135.9", "135.9", "0", 0),
    ]);
    expect(bar).toMatchObject({ open: "135.88", high: "136", low: "135.7", close: "135.9", trades: 3 });
  });

  test("an untraded bucket keeps the carried price", () => {
    const bar = foldBar(0, undefined, [minute(0, "135.63", "135.63", "135.63", "135.63", "0", 0), minute(60_000, "135.63", "135.63", "135.63", "135.63", "0", 0)]);
    expect(bar).toMatchObject({ open: "135.63", high: "135.63", low: "135.63", close: "135.63", volume: "0", trades: 0 });
  });

  test("sub-1e-8 prices keep their digits and venues without trade counts still fold by volume", () => {
    const bar = foldBar(0, undefined, [
      minute(0, "0.0000001066", "0.0000001066", "0.0000001066", "0.0000001066", "0", 0),
      minute(60_000, "0.0000001064", "0.0000001071", "0.0000001061", "0.0000001069", "505905964257", 0),
    ]);
    expect(bar).toMatchObject({ open: "0.0000001064", high: "0.0000001071", low: "0.0000001061", close: "0.0000001069", trades: 0 });
  });

  test("a bucket's close is its last traded close even when later fillers move (Gate)", () => {
    // Gate RHEA_USDT 2026-10-09 12:15-12:19: one traded minute, then zero-volume minutes at a moving reference price; native 5m close is 0.06476.
    const bar = foldBar(0, undefined, [
      minute(0, "0.065", "0.065", "0.06474", "0.06476", "11704", 0),
      minute(60_000, "0.06478", "0.06482", "0.06476", "0.064765", "0", 0),
      minute(240_000, "0.064765", "0.064795", "0.064735", "0.064745", "0", 0),
    ]);
    expect(bar).toMatchObject({ open: "0.065", high: "0.065", low: "0.06474", close: "0.06476", volume: "11704" });
  });
});

describe("venue parsing", () => {
  test("REST rows validate shape and precision", () => {
    const row = [1502942400000, "4261.48000000", "4261.48000000", "4261.48000000", "4261.48000000", "1.77518300", 1502942459999, "7564.90685084", 3, "0.07518300", "320.39085084", "0"];
    expect(parseRestKline(row)).toMatchObject({ openTime: 1502942400000, close: "4261.48", volume: "1.775183", trades: 3 });
    expect(() => parseRestKline([...row.slice(0, 1), "4261.4812345678901234567", ...row.slice(2)])).toThrow();
    expect(() => parseRestKline([...row.slice(0, 1), "1e-7", ...row.slice(2)])).toThrow();
    expect(() => parseRestKline([1502942400001, ...row.slice(1)])).toThrow();
  });

  test("venue decimals normalize to one canonical form", () => {
    expect(priceDecimal("0.000000012328000")).toBe("0.000000012328");
    expect(volumeDecimal("1672.158567157")).toBe("1672.15856715");
    expect(numberDecimal(1.2328e-8)).toBe("0.000000012328");
    expect(numberDecimal(1e21)).toBe("1000000000000000000000");
    expect(numberDecimal(0.000116)).toBe("0.000116");
  });
});

describe("stored resolution tiers", () => {
  const H = 3_600_000, D = 24 * H;
  const first1m = t("2026-10-06T10:17:00Z");

  test("full-history markets read minutes only, for every interval", () => {
    const coverage = { first: { "1m": first1m, "1h": null, "1d": null }, syncedTo: first1m + D };
    expect(tiers(coverage, "1M")).toEqual([{ resolution: "1m", from: first1m, to: Number.MAX_SAFE_INTEGER }]);
    expect(firstFor(coverage, "1m")).toBe(first1m);
    expect(firstFor({ ...coverage, first: { "1m": null, "1h": null, "1d": null } }, "1d")).toBeNull();
  });

  test("coarser tiers end where the finer one starts whole, and only intervals they fit use them", () => {
    const first1h = t("2025-08-22T17:00:00Z"), first1d = t("2025-07-30T00:00:00Z");
    const coverage = { first: { "1m": first1m, "1h": first1h, "1d": first1d }, syncedTo: first1m + D };
    expect(tiers(coverage, "15m")).toEqual([{ resolution: "1m", from: first1m, to: Number.MAX_SAFE_INTEGER }]);
    expect(tiers(coverage, "4h")).toEqual([
      { resolution: "1m", from: t("2026-10-06T11:00:00Z"), to: Number.MAX_SAFE_INTEGER },
      { resolution: "1h", from: first1h, to: t("2026-10-06T11:00:00Z") },
    ]);
    expect(tiers(coverage, "1w")).toEqual([
      { resolution: "1m", from: t("2026-10-06T11:00:00Z"), to: Number.MAX_SAFE_INTEGER },
      { resolution: "1h", from: t("2025-08-23T00:00:00Z"), to: t("2026-10-06T11:00:00Z") },
      { resolution: "1d", from: first1d, to: t("2025-08-23T00:00:00Z") },
    ]);
    expect([firstFor(coverage, "5m"), firstFor(coverage, "12h"), firstFor(coverage, "3d")]).toEqual([first1m, first1h, first1d]);
  });

  test("a coarse tier that starts after the finer boundary is ignored", () => {
    const coverage = { first: { "1m": first1m, "1h": first1m + 2 * H, "1d": null }, syncedTo: first1m + D };
    expect(tiers(coverage, "1h")).toEqual([{ resolution: "1m", from: first1m, to: Number.MAX_SAFE_INTEGER }]);
  });
});
