export class VenueUnavailable extends Error {
  constructor(message: string, readonly status: number, readonly retryAt: number) { super(message); }
}

/** Sent on venue REST requests and, where a WAF requires it, WebSocket handshakes. */
export const USER_AGENT = "DYA-data/1.0";

export type HttpOptions = {
  venue: string;
  url: string;
  /** Requests per minute, paced evenly so per-second venue windows are respected too. */
  budget: number;
  /** Extra request headers, e.g. an API key. */
  headers?: Record<string, string>;
  fetcher?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Public REST client shared by venue adapters: paces requests to the budget, and pauses every
 * request after 429/418 (rate limit/ban), 403/451 (WAF/geo restriction) or 5xx, honouring
 * Retry-After. Venue error envelopes inside 200 responses are the adapter's to check.
 */
export class VenueHttp {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private next = 0;
  private pausedUntil = 0;

  constructor(private readonly options: HttpOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? Bun.sleep;
  }

  /** Waits for `weight` evenly paced slots of the per-minute budget. */
  private async pace(weight: number): Promise<void> {
    for (;;) {
      const now = this.now();
      const at = Math.max(this.next, this.pausedUntil);
      if (now >= at) { this.next = now + (weight * 60_000) / this.options.budget; return; }
      await this.sleep(at - now);
    }
  }

  /** GET `path` (with query) and parse JSON; throws VenueUnavailable on HTTP errors. */
  get(path: string, weight = 1): Promise<unknown> {
    return this.send("GET", path, weight);
  }

  /** POST without a body (e.g. WebSocket token endpoints), paced and paused like GET. */
  post(path: string, weight = 1): Promise<unknown> {
    return this.send("POST", path, weight);
  }

  private async send(method: "GET" | "POST", path: string, weight: number): Promise<unknown> {
    await this.pace(weight);
    const response = await this.fetcher(this.options.url + path, {
      method,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...this.options.headers },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return response.json();
    await response.body?.cancel();
    const status = response.status, now = this.now();
    const retryAfter = Number(response.headers.get("retry-after"));
    const minimum = status === 429 || status === 418 ? 60_000 : status === 403 || status === 451 ? 300_000 : status >= 500 || status < 400 ? 5_000 : 0;
    if (minimum) this.pausedUntil = Math.max(this.pausedUntil, now + Math.max(minimum, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0));
    throw new VenueUnavailable(`${this.options.venue} ${status} for ${path.split("?")[0]}`, status, this.pausedUntil);
  }
}
