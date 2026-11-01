import { prop } from "../json";
import { MINUTE, RESOLUTION_MS, type Kline, type Resolution } from "../candles/kline";
import { USER_AGENT, VenueUnavailable } from "../venues/http";
import type { CandlePage, Instrument, VenueRest } from "../venues/types";
import { parseRestKline } from "./klines";
import { parseAggTrade, type AggTrade } from "./trades";

type Options = {
  url: string;
  weightBudget: number;
  fetcher?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Market-data REST client. Binance limits REQUEST_WEIGHT per IP per minute (6000), so every
 * request reserves weight from a local per-minute budget, adopts the venue's reported usage
 * (x-mbx-used-weight-1m, which includes other processes on the same IP), and pauses all
 * requests after 429/418 (rate limit/ban) or 403/451 (WAF/geo restriction).
 */
export class BinanceRest implements VenueRest {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private window = 0;
  private used = 0;
  private pausedUntil = 0;

  constructor(private readonly options: Options) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? Bun.sleep;
  }

  private async reserve(weight: number): Promise<void> {
    for (;;) {
      const now = this.now();
      if (now < this.pausedUntil) { await this.sleep(this.pausedUntil - now); continue; }
      const window = now - (now % MINUTE);
      if (window !== this.window) { this.window = window; this.used = 0; }
      if (this.used + weight <= this.options.weightBudget) { this.used += weight; return; }
      await this.sleep(window + MINUTE - now + 100);
    }
  }

  private async get(path: string, weight: number): Promise<unknown> {
    await this.reserve(weight);
    const response = await this.fetcher(this.options.url + path, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const reported = Number(response.headers.get("x-mbx-used-weight-1m"));
    const now = this.now();
    if (Number.isFinite(reported) && now - (now % MINUTE) === this.window) this.used = Math.max(this.used, reported);
    if (response.ok) return response.json();
    await response.body?.cancel();
    const status = response.status;
    const retryAfter = Number(response.headers.get("retry-after"));
    const minimum = status === 429 || status === 418 ? 60_000 : status === 403 || status === 451 ? 300_000 : status >= 500 || status < 400 ? 5_000 : 0;
    if (minimum) this.pausedUntil = Math.max(this.pausedUntil, now + Math.max(minimum, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0));
    throw new VenueUnavailable(`Binance ${status} for ${path.split("?")[0]}`, status, this.pausedUntil);
  }

  /** Klines with openTime in [startTime, endTime], at most `limit` (weight 2). */
  async klines(symbol: string, startTime: number, endTime: number, limit = 1000, interval = "1m"): Promise<Kline[]> {
    const rows = await this.get(`/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`, 2);
    if (!Array.isArray(rows)) throw new Error("Invalid klines response");
    const klines = rows.map(parseRestKline);
    for (let i = 1; i < klines.length; i++) if (klines[i]!.openTime <= klines[i - 1]!.openTime) throw new Error("Unordered klines response");
    return klines;
  }

  /** Binance skips empty ranges itself: a short page reached `to`, a full one continues after its last row. */
  async candles(symbol: string, resolution: Resolution, from: number, to: number): Promise<CandlePage> {
    const klines = await this.klines(symbol, from, to - 1, 1000, resolution);
    const last = klines.at(-1);
    return { klines, coveredTo: klines.length === 1000 && last ? last.openTime + RESOLUTION_MS[resolution] : to };
  }

  async earliest(symbol: string, resolution: Resolution): Promise<number | null> {
    return (await this.klines(symbol, 0, this.now(), 1, resolution))[0]?.openTime ?? null;
  }

  nativeCandles(symbol: string, interval: string, from: number, to: number): Promise<Kline[]> {
    return this.klines(symbol, from, to - 1, 1000, interval);
  }

  /** Aggregate trades (weight 4), inclusive id cursor; time is only used for bootstrap. */
  async aggTrades(symbol: string, cursor: { fromId: number } | { startTime: number }): Promise<AggTrade[]> {
    const query = "fromId" in cursor ? `fromId=${cursor.fromId}` : `startTime=${cursor.startTime}`;
    const rows = await this.get(`/api/v3/aggTrades?symbol=${symbol}&${query}&limit=1000`, 4);
    if (!Array.isArray(rows)) throw new Error("Invalid aggregate trades response");
    return rows.map(parseAggTrade);
  }

  /** Spot instruments (weight 20). */
  async instruments(): Promise<Instrument[]> {
    const rows = prop(await this.get("/api/v3/exchangeInfo?permissions=SPOT", 20), "symbols");
    if (!Array.isArray(rows)) throw new Error("Invalid exchangeInfo response");
    return rows.flatMap((row: unknown) => {
      const symbol = prop(row, "symbol"), base = prop(row, "baseAsset"), quote = prop(row, "quoteAsset"), status = prop(row, "status");
      return typeof symbol === "string" && typeof base === "string" && typeof quote === "string" && typeof status === "string"
        ? [{ symbol, base, quote, status }]
        : [];
    });
  }
}
