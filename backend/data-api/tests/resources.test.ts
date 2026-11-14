import { expect, test } from "bun:test";
import { QueryCache } from "../src/api/cache";
import { Semaphore } from "../src/api/semaphore";

test("same page misses share one query and retain identical bodies", async () => {
  const cache = new QueryCache<string>(1);
  const barrier = Promise.withResolvers<{ value: string; ttlMs: number }>();
  let queries = 0;
  const load = () => { queries++; return barrier.promise; };
  const a = cache.get("page", load), b = cache.get("page", load);
  expect(a).toBe(b);
  barrier.resolve({ value: '{"bars":[]}', ttlMs: 60_000 });
  expect(await a).toBe(await b);
  expect(await cache.get("page", load)).toBe('{"bars":[]}');
  expect(queries).toBe(1);
  await cache.get("other", async () => ({ value: "other", ttlMs: 60_000 }));
  await cache.get("page", load);
  expect(queries).toBe(2);
});

test("failed single-flight work does not poison later requests", async () => {
  const cache = new QueryCache<string>();
  await expect(cache.get("page", async () => { throw new Error("unavailable"); })).rejects.toThrow("unavailable");
  expect(await cache.get("page", async () => ({ value: "repaired", ttlMs: 1000 }))).toBe("repaired");
});

test("semaphore transfers capacity to queued work even after failure", async () => {
  const semaphore = new Semaphore(1);
  const barrier = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const first = semaphore.run(async () => { started.resolve(); await barrier.promise; throw new Error("query failed"); });
  await started.promise;
  let entered = false;
  const second = semaphore.run(async () => { entered = true; return "next"; });
  expect(entered).toBe(false);
  barrier.resolve();
  await expect(first).rejects.toThrow("query failed");
  expect(await second).toBe("next");
  expect(await semaphore.run(async () => "released")).toBe("released");
});
