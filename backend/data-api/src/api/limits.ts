import type { RedisClient } from "bun";

export type LimitResult = { allowed: boolean; limit: number; remaining: number; retryAfter: number };
export type Lease = { renew(): Promise<boolean>; release(): Promise<void> };

const consumeScript = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local window = tonumber(ARGV[3])
local reset = window - now % window
local key = KEYS[1] .. ':' .. math.floor(now / window)
local used = tonumber(redis.call('GET', key) or '0')
local allowed = used + tonumber(ARGV[1]) <= tonumber(ARGV[2])
if allowed then
  used = redis.call('INCRBY', key, ARGV[1])
  redis.call('PEXPIRE', key, reset)
end
return {allowed and 1 or 0, math.max(0, tonumber(ARGV[2]) - used), math.ceil(reset / 1000)}
`;
const acquireScript = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
redis.call('PEXPIRE', KEYS[1], math.max(tonumber(ARGV[2]), redis.call('PTTL', KEYS[1])))
return 1
`;
const renewScript = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local expiry = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not expiry or tonumber(expiry) <= now then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], math.max(tonumber(ARGV[2]), redis.call('PTTL', KEYS[1])))
return 1
`;

/** All admission decisions are atomic across API workers; server time avoids clock skew. */
export class SharedLimits {
  constructor(private readonly redis: RedisClient, private readonly namespace = "limits:v1") {}

  async consume(key: string, weight: number, limit: number, windowMs: number): Promise<LimitResult> {
    for (const value of [weight, limit, windowMs]) if (!Number.isSafeInteger(value) || value < 1) throw new Error("Limit values must be positive integers");
    const result: unknown = await this.redis.send("EVAL", [consumeScript, "1", `${this.namespace}:${key}`, String(weight), String(limit), String(windowMs)]);
    if (!Array.isArray(result) || result.length !== 3 || result.some(value => typeof value !== "number")) throw new Error("Invalid rate-limit result");
    return { allowed: result[0] === 1, limit, remaining: Number(result[1]), retryAfter: Number(result[2]) };
  }

  async acquire(key: string, limit: number, ttlMs: number): Promise<Lease | undefined> {
    for (const value of [limit, ttlMs]) if (!Number.isSafeInteger(value) || value < 1) throw new Error("Lease values must be positive integers");
    const redisKey = `${this.namespace}:${key}`;
    const token = crypto.randomUUID();
    const result = await this.redis.send("EVAL", [acquireScript, "1", redisKey, String(limit), String(ttlMs), token]);
    if (result !== 1) return undefined;
    let released = false;
    return {
      renew: async () => !released && await this.redis.send("EVAL", [renewScript, "1", redisKey, token, String(ttlMs)]) === 1,
      release: async () => {
        if (released) return;
        await this.redis.send("ZREM", [redisKey, token]);
        released = true;
      },
    };
  }
}

export function limitHeaders(result: LimitResult): Record<string, string> {
  return { "Retry-After": String(result.retryAfter), "RateLimit-Limit": String(result.limit), "RateLimit-Remaining": String(result.remaining), "RateLimit-Reset": String(result.retryAfter) };
}
