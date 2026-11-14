import { describe, expect, test } from "bun:test";
import { RedisClient } from "bun";
import { clientIp } from "../src/api/client-ip";
import { SharedLimits } from "../src/api/limits";

test("client identity trusts only the configured header", () => {
  const request = new Request("http://localhost", { headers: { "x-real-ip": "203.0.113.4" } });
  expect(clientIp(request, "127.0.0.1", undefined)).toBe("127.0.0.1");
  expect(clientIp(request, "127.0.0.1", "x-real-ip")).toBe("203.0.113.4");
  expect(clientIp(request, "::ffff:127.0.0.1", undefined)).toBe("127.0.0.1");
  expect(() => clientIp(request, "127.0.0.1", "cf-connecting-ip")).toThrow();
});

describe.skipIf(process.env.DATA_API_INTEGRATION !== "1")("shared Valkey admission", () => {
  test("workers share weight and expired leases do not leak slots", async () => {
    const redis = new RedisClient(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
    await redis.connect();
    try {
      const namespace = `test:rest:${crypto.randomUUID()}`;
      const first = new SharedLimits(redis, namespace);
      const second = new SharedLimits(redis, namespace);
      const results = await Promise.all([first.consume("weight", 7, 10, 60_000), second.consume("weight", 7, 10, 60_000)]);
      expect(results.filter(result => result.allowed)).toHaveLength(1);
      expect(results.every(result => result.remaining === 3)).toBe(true);
      const lease = await first.acquire("slots", 1, 100);
      expect(lease).toBeDefined();
      expect(await second.acquire("slots", 1, 100)).toBeUndefined();
      await Bun.sleep(130);
      // Lua uses the independent Valkey TIME clock; JavaScript fake timers cannot expire its leases.
      expect(await lease!.renew()).toBe(false);
      const replacement = await second.acquire("slots", 1, 1000);
      expect(replacement).toBeDefined();
      await lease!.release();
      expect(await first.acquire("slots", 1, 1000)).toBeUndefined();
      expect(await replacement!.renew()).toBe(true);
      await replacement!.release();
      const released = await first.acquire("slots", 1, 100);
      expect(released).toBeDefined();
      await released!.release();
    } finally { redis.close(); }
  });
});
