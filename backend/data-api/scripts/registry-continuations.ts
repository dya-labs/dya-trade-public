import type { RegistryAsset } from "../src/registry-types";

/** Reviewed 1:1 identity continuations, not symbol-based market discovery. */
const continuations: Record<string, { predecessor: string; boundary: number; announcement: string }> = {
  polygon: { predecessor: "MATIC", boundary: Date.parse("2024-09-13T00:00:00Z"), announcement: "https://www.binance.com/en/support/announcement/detail/619c4929fc3f4a0d9df7f9ae1d4519a5" },
  gram: { predecessor: "TON", boundary: Date.parse("2026-07-02T00:00:00Z"), announcement: "https://www.binance.com/en/support/announcement/detail/8177254072cf4da3b9d8fcaacceb0a2c" },
};

export async function addContinuations(assets: RegistryAsset[]): Promise<void> {
  for (const asset of assets) {
    const continuation = asset.coinGeckoId ? continuations[asset.coinGeckoId] : undefined;
    if (!continuation) continue;
    for (const current of [...asset.sources]) {
      if (current.validTo !== null || !current.continuationOf) continue;
      const symbol = `${continuation.predecessor}${current.quote}`;
      if (asset.sources.some(source => source.symbol === symbol)) continue;
      const response = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1m&startTime=0&limit=1`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Historical continuation unavailable: ${symbol}`);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows) || !Array.isArray(rows[0]) || typeof rows[0][0] !== "number") throw new Error(`Historical continuation first trade missing: ${symbol}`);
      current.continuationEvidence = continuation.announcement;
      asset.sources.push({ ...current, id: `binance:${symbol}`, symbol, base: continuation.predecessor, rank: current.rank + 10, validFrom: rows[0][0], validTo: continuation.boundary, continuationOf: null, continuationEvidence: continuation.announcement });
    }
  }
}

if (import.meta.main) {
  const path = new URL("../registry/seed.json", import.meta.url);
  const seed: { assets: RegistryAsset[] } = await Bun.file(path).json();
  await addContinuations(seed.assets);
  await Bun.write(path, JSON.stringify(seed, null, 2) + "\n");
}
