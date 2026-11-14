import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { retryAtFromHeader, RateLimitError } from "@/lib/near/domain/rate-limit";
import { request } from "@/lib/near/http/request";
import { withWalletRateLimit } from "@dya/wallet-ui/hooks/query-policy";
const now = 1_000_000;
const overflow = "1" + "0".repeat(307);
afterEach(() => { vi.useRealTimers();vi.unstubAllGlobals(); });
it.each([{ label: "numeric overflow", header: overflow }, { label: "beyond date range", header: "8640000000001" }])("uses a finite fallback for $label", ({ header }) => {
  expect(retryAtFromHeader(header, now)).toBe(now + 30_000);
});
it("preserves the maximum representable date rather than imposing a shorter business cooldown", () => {
  expect(retryAtFromHeader(String((8.64e15 - now) / 1000), now)).toBe(8.64e15);
});
it("allows shared browser transport to recover after an overflowing429 header", async () => {
  vi.useFakeTimers();vi.setSystemTime(now);
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": overflow } })).mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  const query = {}, read = () => withWalletRateLimit(query, () => request("synthetic-read", z.object({ ok: z.literal(true) })));
  await expect(read()).rejects.toMatchObject({ retryAt: now + 30_000 });
  await expect(read()).rejects.toBeInstanceOf(RateLimitError);expect(fetcher).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(30_000);
  await expect(read()).resolves.toEqual({ ok: true });expect(fetcher).toHaveBeenCalledTimes(2);
});
