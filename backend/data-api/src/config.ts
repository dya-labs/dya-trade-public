import { readFileSync } from "node:fs";
import { NEARDATA_URL, type Neardata } from "./near/neardata";
import { VENUES } from "./venues";
import type { VenueOptions } from "./venues/types";

export type Config = {
  clickhouse: { url: string; user: string; password: string; database: string };
  redisUrl: string;
  /** Reviewed token metadata catalog of the DYA ID service (`DYA_ID_CATALOG_URL`), read by CoinGecko metadata ingestion. */
  idCatalogUrl: string | undefined;
  /** Per venue id; overridable with `<ID>_REST_URL`, `<ID>_STREAM_URL`, `<ID>_BUDGET`. */
  venues: Record<string, VenueOptions>;
  /** CoinGecko Demo key for token metadata (`COINGECKO_API_KEY`); without it, the keyless API. */
  coinGeckoApiKey: string | undefined;
  /** NEAR Intents Explorer key (`INTENTS_EXPLORER_JWT`, partner key type "explorer"); without it, no Intents history. */
  intentsExplorerJwt: string | undefined;
  /** NEAR blocks for the feed and repair (`NEARDATA_URL`), with a FastNEAR key (`FASTNEAR_API_KEY`). */
  neardata: Neardata;
  /** Operator override of the ingested symbols (for the venue being ingested); empty = registry. */
  symbols: string[];
  api: { port: number; workers: number; corsOrigins: string[]; clientIpHeader: string | undefined; rateLimitPerMinute: number };
};

type Env = Record<string, string | undefined>;

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  return value;
}

/** Validated URL; REST bases drop a trailing slash (paths are appended), stream URLs stay verbatim (Gate needs `/ws/v4/`). */
function url(env: Env, name: string, fallback: string, protocols: string[], keepSlash = false): string {
  const raw = env[name]?.trim() || fallback;
  const value = new URL(raw);
  if (!protocols.includes(value.protocol)) throw new Error(`${name} must use ${protocols.join(" or ")}`);
  return keepSlash ? raw : value.toString().replace(/\/$/, "");
}

export function loadConfig(env: Env = process.env): Config {
  const symbols = (env.MARKET_SYMBOLS ?? "").split(",").map(symbol => symbol.trim()).filter(Boolean);
  for (const symbol of symbols) if (!/^[A-Za-z0-9_-]{2,30}$/.test(symbol)) throw new Error(`Invalid symbol in MARKET_SYMBOLS: ${symbol}`);
  const database = env.CLICKHOUSE_DATABASE?.trim() || "market";
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error("CLICKHOUSE_DATABASE must be a plain identifier");
  if (env.CLICKHOUSE_PASSWORD && env.CLICKHOUSE_PASSWORD_FILE) {
    throw new Error("Set only one of CLICKHOUSE_PASSWORD and CLICKHOUSE_PASSWORD_FILE");
  }
  const password = env.CLICKHOUSE_PASSWORD_FILE
    ? readFileSync(env.CLICKHOUSE_PASSWORD_FILE, "utf8").replace(/\r?\n$/, "")
    : env.CLICKHOUSE_PASSWORD ?? "";
  return {
    clickhouse: {
      url: url(env, "CLICKHOUSE_URL", "http://127.0.0.1:8123", ["http:", "https:"]),
      user: env.CLICKHOUSE_USER?.trim() || "default",
      password,
      database,
    },
    idCatalogUrl: env.DYA_ID_CATALOG_URL?.trim() ? url(env, "DYA_ID_CATALOG_URL", "", ["http:", "https:"]) : undefined,
    redisUrl: url(env, "REDIS_URL", "redis://127.0.0.1:6379", ["redis:", "rediss:"]),
    venues: Object.fromEntries(Object.values(VENUES).map(({ id, defaults }) => {
      const prefix = id.toUpperCase();
      return [id, {
        // Venues read from the NEAR block feed have no REST API or stream of their own.
        restUrl: defaults.restUrl ? url(env, `${prefix}_REST_URL`, defaults.restUrl, ["https:"]) : "",
        streamUrl: defaults.streamUrl ? url(env, `${prefix}_STREAM_URL`, defaults.streamUrl, ["wss:"], true) : "",
        budget: int(env, `${prefix}_BUDGET`, defaults.budget, 1, 100_000),
      }];
    })),
    coinGeckoApiKey: env.COINGECKO_API_KEY?.trim() || undefined,
    intentsExplorerJwt: env.INTENTS_EXPLORER_JWT?.trim() || undefined,
    neardata: { url: url(env, "NEARDATA_URL", NEARDATA_URL, ["https:"]), apiKey: env.FASTNEAR_API_KEY?.trim() || undefined },
    symbols: [...new Set(symbols)],
    api: {
      port: int(env, "API_PORT", 8080, 1, 65535),
      workers: int(env, "API_WORKERS", 1, 1, 256),
      corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:3100").split(",").map(origin => origin.trim()).filter(Boolean),
      clientIpHeader: env.CLIENT_IP_HEADER?.trim().toLowerCase() || undefined,
      rateLimitPerMinute: int(env, "RATE_LIMIT_PER_MINUTE", 1200, 1, 1_000_000),
    },
  };
}
