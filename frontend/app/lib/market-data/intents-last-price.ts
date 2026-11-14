import type { CatalogAsset } from "@/lib/near/domain/catalog";
import type { IntentsTrade } from "./api";

const MAX_AGE_MS = 10 * 60_000;
/** Intents trade prices (Market trades: public, plus confidential where the market includes them) are USD; convert using the quote token's actual USD price. */
export function intentsLastPrice(trades: IntentsTrade[] | undefined, quote: CatalogAsset | undefined, now: number): number | null {
  const latest = trades?.reduce<IntentsTrade | undefined>((last, trade) => !last || trade.time > last.time ? trade : last, undefined);
  if (!latest || !quote || !Number.isFinite(now) || now <= 0) return null;
  const updated = Date.parse(quote.priceUpdatedAt ?? "");
  const fresh = (time: number) => Number.isFinite(time) && time <= now + 60_000 && now - time < MAX_AGE_MS;
  const price = Number(latest.price), quoteUsd = Number(quote.price);
  if (!fresh(latest.time) || !fresh(updated) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(quoteUsd) || quoteUsd <= 0) return null;
  const result = price / quoteUsd;
  return Number.isFinite(result) && result > 0 ? result : null;
}
