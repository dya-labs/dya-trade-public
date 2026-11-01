import { RedisClient } from "bun";
import type { ClickHouse } from "../clickhouse";
import type { Config } from "../config";
import { log } from "../log";
import { NearBlockFeed, valkeyNearBlocks } from "../near/feed";
import { loadNearState } from "../near/indexer";
import { intentsSource } from "../venues/intents/indexer";
import { rheaSource } from "../venues/rhea/indexer";

/** The NEAR indexers' sources: the feed keeps exactly the logs they parse. */
const SOURCES = [rheaSource, intentsSource];

/** Runs the shared NEAR block feed (`ingest-near`) that the Rhea and Intents indexers read. */
export async function runNearFeed(config: Config, clickhouse: ClickHouse): Promise<() => Promise<void>> {
  if (!config.neardata.apiKey) log("near.feed.unkeyed", { detail: "FASTNEAR_API_KEY is not set; neardata's free tier can't follow the chain" }, "warn");
  const redis = new RedisClient(config.redisUrl);
  await redis.connect();
  const blocks = valkeyNearBlocks(config.redisUrl);
  const feed = new NearBlockFeed({
    neardata: config.neardata, blocks, redis,
    accounts: new Set(SOURCES.flatMap(source => [...source.accounts])),
    keep: entry => SOURCES.some(source => source.accounts.has(entry.account) && source.matches(entry)),
    // An empty stream starts after the furthest-behind cursor, so one fetch serves every indexer's gap.
    start: async () => {
      const cursors = (await Promise.all(SOURCES.map(source => loadNearState(clickhouse, source.stateTable)))).flatMap(state => state.cursor ? [state.cursor.height] : []);
      return cursors.length ? Math.min(...cursors) + 1 : null;
    },
  });
  const running = feed.run();
  return async () => {
    feed.stop();
    await running;
    blocks.close();
    redis.close();
  };
}
