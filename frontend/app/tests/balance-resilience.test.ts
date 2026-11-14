import { afterEach, describe, expect, it, vi } from "vitest";
import { readBalances } from "../../../backend/id/src/near/providers/live";
import { RateLimitError, retryAtFromHeader } from "@/lib/near/domain/rate-limit";
const account = "0x" + "1".repeat(40);
const assets = [{ assetId: "token", symbol: "T", decimals: 6 }];
function success() { return Response.json({ result: { block_height: 42, result: [...Buffer.from(JSON.stringify(["1000000"]))] } }); }
afterEach(() => vi.useRealTimers());
describe("balance request resilience", () => {
  it("honors Retry-After once both RPC providers rate-limit, and prevents manual requests during cooldown", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000000);
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 429 })).mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "345" } })).mockImplementation(async () => success());
    await expect(readBalances(account, fetcher, assets)).rejects.toMatchObject({ retryAt: 1345000 });
    await expect(readBalances(account, fetcher, assets)).rejects.toBeInstanceOf(RateLimitError);
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(345000);
    expect((await readBalances(account, fetcher, assets)).assets[0].amount).toBe("1");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("shares concurrent identical reads but does not cache completed transaction checks", async () => {
    const fetcher = vi.fn(async () => success());
    await Promise.all([readBalances(account, fetcher, assets), readBalances(account, fetcher, assets)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await readBalances(account, fetcher, assets);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("backs off repeated 429s even without a Retry-After header", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000000);
    const fetcher = vi.fn(async () => new Response("", { status: 429 }));
    await expect(readBalances(account, fetcher, assets)).rejects.toMatchObject({ retryAt: 1030000 });
    vi.advanceTimersByTime(30000);
    await expect(readBalances(account, fetcher, assets)).rejects.toMatchObject({ retryAt: 1090000 });
  });
  it("supports HTTP dates and safely defaults invalid retry headers", () => {
    expect(retryAtFromHeader("Thu, 01 Jan 1970 00:01:00 GMT", 0)).toBe(60000);
    expect(retryAtFromHeader("invalid", 0)).toBe(30000);
  });
});
