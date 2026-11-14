import { z } from "zod";
import { tokenLinksSchema, tokenMarketsSchema } from "@/lib/near/domain/token-icons";

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);

export const metaSchema = z.object({
  serverTime: z.number(),
  intervals: z.array(z.string()).min(1),
  pageSize: z.number().int().positive(),
  revision: z.string().min(1),
});
export type DataMeta = z.infer<typeof metaSchema>;

const sourceSchema = z.object({ id: z.string(), venue: z.string(), symbol: z.string(), base: z.string(), quote: z.string(), rank: z.number() });
export const assetsSchema = z.object({
  assets: z.array(z.object({
    assetId: z.string(),
    symbol: z.string(),
    primaryMarket: z.string().nullable(),
    alternatives: z.array(z.string()),
    sourceLabel: z.string().nullable(),
    unavailableReason: z.string().nullable(),
    sources: z.array(sourceSchema),
  })),
});
export type DataAsset = z.infer<typeof assetsSchema>["assets"][number];

export const marketsSchema = z.object({
  markets: z.array(z.object({
    id: z.string(),
    venue: z.string(),
    sourceLabel: z.string(),
    symbol: z.string(),
    base: z.string(),
    quote: z.string(),
    assetId: z.string(),
    firstOpenTime: z.number(),
    intervals: z.array(z.string()),
  })),
  /** Set while the 1Click catalog is unreachable; markets stay listed. Absent on older deployments. */
  degraded: z.object({ cause: z.string(), since: z.number() }).nullable().optional(),
});
export type DataDegraded = NonNullable<z.infer<typeof marketsSchema>["degraded"]>;
export type DataMarket = z.infer<typeof marketsSchema>["markets"][number];

/** `[openTime, open, high, low, close, volume, quoteVolume, trades, takerBuyVolume, takerBuyQuoteVolume]`. */
const barSchema = z.tuple([z.number(), decimal, decimal, decimal, decimal, decimal, decimal, z.number(), decimal, decimal]);
export type PageBar = z.infer<typeof barSchema>;
export const pageSchema = z.object({
  market: z.string(),
  interval: z.string(),
  revision: z.string(),
  page: z.number().int(),
  prev: z.number().int().nullable(),
  final: z.boolean(),
  bars: z.array(barSchema),
}).refine(page => page.prev === null || page.prev < page.page);
export type CandlePage = z.infer<typeof pageSchema>;

export const tickerSchema = z.object({
  symbol: z.string(),
  lastPrice: decimal,
  openPrice: decimal,
  highPrice: decimal,
  lowPrice: decimal,
  volume: decimal,
  quoteVolume: decimal,
  eventTime: z.number(),
  changePercent: z.number(),
});
export type Ticker = z.infer<typeof tickerSchema>;
const tickersSchema = z.object({ tickers: z.array(tickerSchema.extend({ market: z.string() })) });

export const intentsTradesSchema = z.object({
  market: z.string(),
  trades: z.array(z.object({ time: z.number().min(-8_640_000_000_000_000).max(8_640_000_000_000_000), price: decimal, quantity: decimal, side: z.enum(["buy", "sell"]), txHash: z.string() })),
});
export type IntentsTrade = z.infer<typeof intentsTradesSchema>["trades"][number];

export class DataApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
const unavailableMessage = "Market data is unavailable. Try again shortly.";

/** Client for the public data API (`backend/data-api`). Used by the browser and the Terminal Worker. */
export class DataApi {
  constructor(readonly origin: string, private readonly fetcher: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init)) {}

  private async get<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const response = await this.fetcher(`${this.origin}${path}`, { signal });
    if (!response.ok) throw new DataApiError(response.status, response.status === 429 ? "Market data is rate limited. Try again shortly." : unavailableMessage);
    try { return schema.parse(await response.json()); }
    catch (error) { if (signal?.aborted) throw error; throw new DataApiError(502, unavailableMessage); }
  }

  meta(signal?: AbortSignal) { return this.get("/v1/meta", metaSchema, signal); }
  assets(signal?: AbortSignal) { return this.get("/v1/assets", assetsSchema, signal); }
  markets(signal?: AbortSignal) { return this.get("/v1/markets", marketsSchema, signal); }
  async page(market: string, interval: string, page: number, revision: string, signal?: AbortSignal) {
    const result = await this.get(`/v1/candles?${new URLSearchParams({ market, interval, page: String(page), rev: revision })}`, pageSchema, signal);
    if (result.market !== market || result.interval !== interval || result.page !== page || result.revision !== revision) throw new DataApiError(502, unavailableMessage);
    return result;
  }
  async latest(market: string, interval: string, signal?: AbortSignal) {
    const result = await this.get(`/v1/candles/latest?${new URLSearchParams({ market, interval })}`, pageSchema, signal);
    if (result.market !== market || result.interval !== interval) throw new DataApiError(502, unavailableMessage);
    return result;
  }
  async tickers(markets: string[], signal?: AbortSignal) {
    return (await this.get(`/v1/tickers?${new URLSearchParams({ markets: markets.join(",") })}`, tickersSchema, signal)).tickers;
  }
  /** A NEAR Intents market's newest public trades of the last day, newest first. */
  async intentsTrades(market: string, signal?: AbortSignal) {
    const result = await this.get(`/v1/intents/trades?${new URLSearchParams({ market })}`, intentsTradesSchema, signal);
    if (result.market !== market) throw new DataApiError(502, unavailableMessage);
    return result.trades;
  }
  /** CoinGecko price, 24h change and volume, market cap and image per 1Click asset id, refreshed every 10 minutes. */
  tokenLinks(signal?: AbortSignal) { return this.get("/v1/token-links", tokenLinksSchema, signal); }
  tokenMarkets(signal?: AbortSignal) { return this.get("/v1/token-markets", tokenMarketsSchema, signal); }
}
