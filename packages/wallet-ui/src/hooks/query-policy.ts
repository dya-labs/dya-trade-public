import { ConfidentialAccessRequired } from "../lib/near/domain/confidential-access-error";
import { RateLimitError } from "../lib/near/domain/rate-limit";

// Query state can clear an initial error before the next queryFn starts. Keep
// the server cooldown on the query instance, shared by all its observers and
// released with that query when account data is removed from the cache.
const cooldowns = new WeakMap<object, RateLimitError>();
export async function withWalletRateLimit<T>(query: object, request: () => Promise<T>): Promise<T> {
  const cooldown = cooldowns.get(query);
  if (cooldown && cooldown.retryAt > Date.now()) throw cooldown;
  try {
    const result = await request();
    cooldowns.delete(query);
    return result;
  } catch (error) {
    if (error instanceof RateLimitError) cooldowns.set(query, error);
    else cooldowns.delete(query);
    throw error;
  }
}

export function walletPollingInterval(query: { state: { error: unknown; errorUpdateCount: number } }, interval = 30000) {
  if (query.state.error instanceof ConfidentialAccessRequired) return false;
  if (query.state.error instanceof RateLimitError) return Math.max(1000, query.state.error.retryAt - Date.now());
  return Math.min(300000, interval * 2 ** Math.min(query.state.error ? query.state.errorUpdateCount : 0, 4));
}
