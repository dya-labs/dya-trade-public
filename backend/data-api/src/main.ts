import { runApi } from "./api/server";
import { ClickHouse } from "./clickhouse";
import { loadConfig } from "./config";
import { runIngest } from "./ingest/run";
import { runNearFeed } from "./ingest/near-feed";
import { KlineSync } from "./ingest/sync";
import { runTokenMarkets } from "./markets/token-markets";
import { migrate } from "./migrate";
import { CandleStore } from "./candles/store";
import { verifyParity } from "./verify";
import { persistRegistry, readRegistrySeed } from "./registry";
import { log } from "./log";
import { venue, VENUES } from "./venues";
import { repairIntents } from "./venues/intents/repair";

const config = loadConfig();
const clickhouse = new ClickHouse(config.clickhouse);
const context = { clickhouse, redisUrl: config.redisUrl, intentsExplorerJwt: config.intentsExplorerJwt, neardata: config.neardata };
const [role, ...args] = process.argv.slice(2);

async function serve(start: () => Promise<() => Promise<void>>, children: Bun.Subprocess[] = []) {
  const stop = await start();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      for (const child of children) child.kill(signal);
      void stop().finally(() => process.exit(0));
    });
  }
}

/** `venue:SYMBOL` → its parts; the venue must be supported. */
function marketId(id: string): { venue: string; symbol: string } {
  const [venueId = "", symbol = ""] = id.split(/:(.*)/s);
  if (!symbol) throw new Error(`Market ids look like binance:BTCUSDT, got ${id}`);
  return { venue: venue(venueId).id, symbol };
}

switch (role) {
  case "migrate":
    await migrate(clickhouse);
    await persistRegistry(clickhouse, process.env.DATA_REVISION?.trim() || "1");
    break;
  case "sync": {
    // One-off catch-up for the given market ids (default: every registry market), e.g. `sync okx:OKB-USDT`.
    const started = performance.now();
    const ids = args.length ? args : (await readRegistrySeed()).assets.flatMap(asset => asset.sources.map(source => source.id));
    const byVenue = Map.groupBy([...new Set(ids)].map(marketId), market => market.venue);
    const results = await Promise.all([...byVenue].map(async ([id, markets]) => {
      const selected = VENUES[id]!;
      const rest = selected.rest(config.venues[id]!, context);
      const wanted = new Set(markets.map(market => market.symbol));
      const instruments = (await rest.instruments()).filter(instrument => wanted.has(instrument.symbol));
      await clickhouse.insert("instruments", instruments.map(instrument => ({ venue: id, ...instrument, updated_at: String(Date.now()) })));
      const synced = await new KlineSync({ clickhouse, rest, venue: selected }).syncAll([...wanted]);
      for (const result of synced) log("sync.symbol", { venue: id, ...result });
      return synced;
    }));
    log("sync.done", { rows: results.flat().reduce((sum, result) => sum + result.rows, 0), ms: Math.round(performance.now() - started) });
    break;
  }
  case "repair-intents": {
    const [from, to] = args;
    if (!from || !to || args.length !== 2) throw new Error("usage: repair-intents FROM_ISO_UTC TO_ISO_UTC (whole hours; stop ingest-intents first)");
    const result = await repairIntents(context, Date.parse(from), Date.parse(to));
    log("intents.repair.done", result);
    break;
  }
  case "verify": {
    // Exact parity against the venue's native candles, e.g. `verify binance:BTCUSDT 1h 1d`.
    const [id, ...intervals] = args;
    if (!id) throw new Error("usage: verify VENUE:SYMBOL [INTERVAL...]");
    const market = marketId(id);
    const selected = venue(market.venue);
    const reports = await verifyParity(selected, selected.rest(config.venues[market.venue]!, context), new CandleStore(clickhouse), market, intervals.length ? intervals : selected.parityIntervals);
    for (const report of reports) log("verify.report", report, report.mismatched || report.missingHere || report.missingAtVenue ? "error" : "info");
    if (reports.some(report => report.mismatched || report.missingHere || report.missingAtVenue)) process.exitCode = 1;
    break;
  }
  case "ingest": {
    const [id] = args;
    if (!id) throw new Error(`usage: ingest VENUE (${Object.keys(VENUES).join("|")})`);
    const selected = venue(id);
    await serve(() => runIngest(config, clickhouse, selected));
    break;
  }
  case "near-feed":
    // Follows NEAR's finalized blocks once for every NEAR indexer (Rhea, Intents).
    await serve(() => runNearFeed(config, clickhouse));
    break;
  case "token-markets":
    await serve(() => runTokenMarkets(config));
    break;
  case "api": {
    // Extra workers share the port via SO_REUSEPORT; each is a full, independent API process.
    const children = process.env.DATA_API_WORKER ? [] : Array.from({ length: config.api.workers - 1 }, (_, i) =>
      Bun.spawn([process.execPath, ...process.argv.slice(1)], { env: { ...process.env, DATA_API_WORKER: String(i + 1) }, stdio: ["ignore", "inherit", "inherit"] }));
    await serve(() => runApi(config, clickhouse), children);
    break;
  }
  default:
    console.error("usage: bun src/main.ts <migrate|sync [VENUE:SYMBOL...]|repair-intents FROM_ISO_UTC TO_ISO_UTC|verify VENUE:SYMBOL [INTERVAL...]|ingest VENUE|near-feed|token-markets|api>");
    process.exit(2);
}
